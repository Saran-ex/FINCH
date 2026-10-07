const { app, BrowserWindow, dialog, Menu, session, shell } = require('electron');
const fs = require('node:fs');

const paths = require('./lib/paths');
const ports = require('./lib/ports');
const services = require('./lib/services');
const { createOllamaMonitor } = require('./lib/ollama');

const BOOT_TIMEOUT_MS = 30000;
const HEALTH_URL = `http://127.0.0.1:${paths.BACKEND_PORT}/health`;

let mainWindow = null;
let rendererPort = null;
let frontendChild = null;
let backendChild = null;
let ollamaMonitor = null;
let childLog = null;
let shuttingDown = false;
let childDeathReported = false;

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  // Second launch: the first instance gets the 'second-instance' event.
  app.quit();
} else {
  app.on('second-instance', focusWindow);
  app.whenReady().then(boot).catch((error) => fatal('Finch could not start', error));
}

async function boot() {
  app.setAppUserModelId('com.finch.desktop');
  Menu.setApplicationMenu(null);
  childLog = services.createChildLog();
  childLog.write(`Finch electron layer starting ${new Date().toISOString()}\n`);

  if (!(await ports.isPortFree(paths.BACKEND_PORT))) {
    await showError(
      'Port 3001 in use',
      'Finch backend port 3001 is already in use. Close other Finch instances and try again.',
    );
    app.quit();
    return;
  }

  const missingBuilds = describeMissingBuilds();
  if (missingBuilds) {
    await showError('Finch build missing', missingBuilds);
    app.quit();
    return;
  }

  const assets = services.ensureBackendDistAssets();
  if (assets.error) {
    await showError(
      'Backend migration files missing',
      `Could not copy the .sql migration files into the backend build:\n${assets.error}`,
    );
    app.quit();
    return;
  }
  if (assets.copied > 0) {
    childLog.write(
      `[supervisor] copied ${assets.copied} migration .sql file(s) into finch-backend/dist/db/migrations\n`,
    );
  }

  rendererPort = await ports.findFreePort(paths.RENDERER_PORT_CANDIDATE, [
    paths.BACKEND_PORT,
  ]);
  childLog.write(`[supervisor] UI server port: ${rendererPort}\n`);

  // The UI server comes up first so the backend can start with the matching
  // CORS_ORIGIN (http://localhost:<rendererPort>).
  frontendChild = services.spawnElectronNode({
    label: 'ui',
    script: paths.frontendEntry,
    cwd: paths.frontendServerDir,
    env: { PORT: String(rendererPort), HOST: '127.0.0.1', NODE_ENV: 'production' },
    log: childLog,
  });
  services.watchUnexpectedExit(frontendChild, onChildDeath);
  await services.waitForHttpOk(`http://localhost:${rendererPort}/`, {
    label: 'Finch UI server',
    child: frontendChild,
    timeoutMs: BOOT_TIMEOUT_MS,
  });
  if (shuttingDown) return;

  backendChild = services.spawnElectronNode({
    label: 'backend',
    script: paths.backendEntry,
    cwd: paths.backendDir,
    // Resolves the "@/..." aliases tsc left in dist/ (see lib/backend-alias-*).
    nodeArgs: paths.backendAliasArgs(),
    env: {
      PORT: String(paths.BACKEND_PORT),
      NODE_ENV: 'production',
      CORS_ORIGIN: `http://localhost:${rendererPort}`,
    },
    log: childLog,
  });
  services.watchUnexpectedExit(backendChild, onChildDeath);
  await services.waitForHttpOk(HEALTH_URL, {
    label: 'Finch backend',
    child: backendChild,
    timeoutMs: BOOT_TIMEOUT_MS,
  });
  if (shuttingDown) return;

  configureSession();
  await createWindow();

  ollamaMonitor = createOllamaMonitor(() => mainWindow);
  ollamaMonitor.start();
}

function describeMissingBuilds() {
  const notes = [];
  if (!fs.existsSync(paths.backendEntry)) {
    notes.push(
      `Backend build not found:\n${paths.backendEntry}\n\nRun "npm run build" in:\n${paths.backendDir}`,
    );
  }
  if (!fs.existsSync(paths.frontendEntry)) {
    notes.push(
      `UI build not found:\n${paths.frontendEntry}\n\nRun "npm run build" in:\n${paths.frontendDir}`,
    );
  }
  return notes.join('\n\n');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: 'Finch',
    icon: paths.windowIcon(),
    backgroundColor: '#0e1116',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isRendererUrl(url)) return;
    event.preventDefault();
    openExternal(url);
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    if (input.key === 'F5' || (input.control && key === 'r')) {
      mainWindow.webContents.reload();
      event.preventDefault();
    } else if (input.control && input.shift && key === 'i' && !app.isPackaged) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
      event.preventDefault();
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (ollamaMonitor) ollamaMonitor.refresh();
  });

  mainWindow.once('ready-to-show', () => {
    clearTimeout(revealFallback);
    if (mainWindow) mainWindow.show();
  });

  // Fallback so a first paint that never happens cannot leave an invisible app.
  const revealFallback = setTimeout(() => {
    if (mainWindow) mainWindow.show();
  }, 15000);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow.loadURL(`http://localhost:${rendererPort}`);
}

// Microphone only, and only for the local UI origin: getUserMedia asks for the
// "media" permission, everything else (notifications, clipboard, ...) is denied.
function configureSession() {
  const allowedOrigins = new Set([
    `http://localhost:${rendererPort}`,
    `http://127.0.0.1:${rendererPort}`,
  ]);

  const originOf = (url) => {
    try {
      return new URL(url).origin;
    } catch {
      return '';
    }
  };

  const isLocalOrigin = (webContents, extraUrl) => {
    const fromContents =
      webContents && !webContents.isDestroyed() ? webContents.getURL() : '';
    return [fromContents, extraUrl].some(
      (candidate) => candidate && allowedOrigins.has(originOf(candidate)),
    );
  };

  const wantsMicrophone = (details) => {
    const mediaTypes = details && details.mediaTypes;
    return !Array.isArray(mediaTypes) || mediaTypes.includes('audio');
  };

  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      callback(
        permission === 'media' &&
          wantsMicrophone(details) &&
          isLocalOrigin(webContents, details && details.requestingUrl),
      );
    },
  );

  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin) =>
      permission === 'media' && isLocalOrigin(webContents, requestingOrigin),
  );
}

function isRendererUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
      parsed.port === String(rendererPort)
    );
  } catch {
    return false;
  }
}

function openExternal(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

function focusWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

// Keeps the failure on screen: the dialog is awaited and only quits once the
// user dismisses it, so an app.exit() elsewhere cannot flash it away.
async function onChildDeath(label, code, signal, tail) {
  if (childLog) {
    childLog.write(`[supervisor] ${label} stopped (code=${code}, signal=${signal})\n`);
  }
  if (shuttingDown || childDeathReported) return;
  childDeathReported = true;
  const name = label === 'ui' ? 'Finch UI server' : 'Finch backend';
  try {
    await showError(
      `${name} stopped`,
      `The ${name} stopped unexpectedly (exit code ${code}).\n\n${tail}\n\nDetails: ${childLog ? childLog.file : ''}`,
    );
  } catch {}
  app.quit();
}

function showError(title, message) {
  const options = {
    type: 'error',
    title: 'Finch',
    message: title,
    detail: message,
    buttons: ['OK'],
    defaultId: 0,
  };
  return mainWindow && !mainWindow.isDestroyed()
    ? dialog.showMessageBox(mainWindow, options)
    : dialog.showMessageBox(options);
}

async function fatal(title, error) {
  if (shuttingDown) {
    return;
  }
  // A dead child already owns the error dialog (it quits when dismissed), so
  // quitting here would flash the message away before it can be read.
  if (childDeathReported) {
    return;
  }
  const detail = [error && error.stack ? error.stack : String(error)];
  if (childLog) detail.push(`Child log: ${childLog.file}`);
  await showError(title, detail.join('\n\n'));
  app.quit();
}

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', (event) => {
  if (shuttingDown) return;
  shuttingDown = true;
  event.preventDefault();
  if (ollamaMonitor) ollamaMonitor.stop();
  Promise.all([
    services.stopChild(backendChild),
    services.stopChild(frontendChild),
  ])
    .catch(() => {})
    .finally(() => {
      if (childLog) {
        childLog.write(`Finch electron layer stopped ${new Date().toISOString()}\n`);
      }
      const flushed = childLog ? childLog.close() : Promise.resolve();
      flushed.then(() => app.exit(0), () => app.exit(0));
    });
});
