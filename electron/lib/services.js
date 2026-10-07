const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const paths = require('./paths');

const TAIL_LINES = 50;
const GRACEFUL_EXIT_MS = 3000;
const FORCE_EXIT_WAIT_MS = 2000;
const PROBE_TIMEOUT_MS = 2000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Appends child-process output to %LOCALAPPDATA%\Finch\logs\electron-child.log
// so a silent (windowless) backend/UI server can still be debugged.
function createChildLog() {
  const file = paths.childLogPath();
  let stream = null;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    stream = fs.createWriteStream(file, { flags: 'a' });
  } catch {
    stream = null;
  }
  return {
    file,
    write(chunk) {
      if (!stream) return;
      try {
        stream.write(chunk);
      } catch {}
    },
    // Resolves once buffered output is on disk (or after a short safety delay),
    // so app.exit() cannot truncate the last log lines.
    close() {
      if (!stream) return Promise.resolve();
      const current = stream;
      stream = null;
      return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        try {
          current.end(finish);
        } catch {
          finish();
        }
        setTimeout(finish, 500);
      });
    },
  };
}

// Runs a script with Electron's own Node (ELECTRON_RUN_AS_NODE), silently:
// no terminal window, output piped into the child log and a short tail that
// error dialogs can quote.
function spawnElectronNode({ label, script, cwd, env = {}, log, nodeArgs = [] }) {
  const child = spawn(process.execPath, [...nodeArgs, script], {
    cwd,
    env: { ...process.env, ...env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.finchLabel = label;
  child.finchTail = [];
  child.finchExited = false;
  child.finchStopping = false;

  let pending = '';

  const writeLine = (line) => {
    if (!line.trim()) return;
    child.finchTail.push(line);
    if (child.finchTail.length > TAIL_LINES) child.finchTail.shift();
    if (log) log.write(`[${new Date().toISOString()}] [${label}] ${line}\n`);
  };

  const record = (chunk) => {
    pending += String(chunk);
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    lines.forEach(writeLine);
  };

  child.stdout.on('data', record);
  child.stderr.on('data', record);
  child.once('exit', (code, signal) => {
    child.finchExited = true;
    if (pending.trim()) writeLine(pending);
    writeLine(`${label} exited (code=${code}, signal=${signal})`);
  });
  child.once('error', (error) => {
    child.finchExited = true;
    writeLine(`${label} could not start: ${error.message}`);
  });

  return child;
}

// tsc copies no non-TS assets, so dist/db/migrations ships without the .sql
// files that runMigrations() reads next to its own module. Copy them from src
// before the backend starts (idempotent; dist is build output, never source).
// Packaged installs ship dist with the .sql files already in place and carry
// no src/ folder, so there is nothing to copy there.
function ensureBackendDistAssets() {
  const sourceDir = path.join(paths.backendDir, 'src', 'db', 'migrations');
  const targetDir = path.join(paths.backendDir, 'dist', 'db', 'migrations');
  if (!fs.existsSync(sourceDir) || !fs.existsSync(targetDir)) {
    return { copied: 0, error: '' };
  }

  let copied = 0;
  for (const name of fs.readdirSync(sourceDir)) {
    if (!name.endsWith('.sql')) continue;
    const source = path.join(sourceDir, name);
    const target = path.join(targetDir, name);
    try {
      const sourceStat = fs.statSync(source);
      if (fs.existsSync(target)) {
        const targetStat = fs.statSync(target);
        if (targetStat.size === sourceStat.size && targetStat.mtimeMs >= sourceStat.mtimeMs) {
          continue;
        }
      }
      fs.copyFileSync(source, target);
      copied += 1;
    } catch (error) {
      return { copied, error: `${name}: ${error.message}` };
    }
  }
  return { copied, error: '' };
}

function requestOk(url) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const request = http.get(url, { timeout: PROBE_TIMEOUT_MS }, (response) => {
      response.resume();
      finish(response.statusCode >= 200 && response.statusCode < 300);
    });
    request.on('error', () => finish(false));
    request.on('timeout', () => {
      request.destroy();
      finish(false);
    });
  });
}

async function waitForHttpOk(url, { label, child, timeoutMs = 30000 }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.finchExited) {
      const tail = child.finchTail.slice(-15).join('\n');
      throw new Error(`${label} exited before it was ready.\n${tail}`);
    }
    if (await requestOk(url)) return;
    await delay(300);
  }
  throw new Error(
    `${label} did not answer ${url} within ${Math.round(timeoutMs / 1000)} seconds.`,
  );
}

// Windows has no POSIX signals for a console-less child, so the tree is torn
// down with taskkill (this also covers helper exes the backend spawned).
function killTree(pid) {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.once('exit', resolve);
      killer.once('error', () => resolve());
      return;
    }
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
    resolve();
  });
}

// Graceful signal first, then a tree kill after a few seconds if the child is
// still alive.
async function stopChild(child) {
  if (!child || child.finchExited) return;
  child.finchStopping = true;
  const exited = new Promise((resolve) => {
    if (child.finchExited) {
      resolve();
      return;
    }
    child.once('exit', resolve);
  });

  try {
    child.kill();
  } catch {}

  const stoppedGracefully = await Promise.race([
    exited.then(() => true),
    delay(GRACEFUL_EXIT_MS).then(() => false),
  ]);
  if (!stoppedGracefully && !child.finchExited) await killTree(child.pid);
  await Promise.race([exited, delay(FORCE_EXIT_WAIT_MS)]);
}

function watchUnexpectedExit(child, onUnexpectedExit) {
  child.once('exit', (code, signal) => {
    if (child.finchStopping) return;
    onUnexpectedExit(child.finchLabel, code, signal, child.finchTail.slice(-15).join('\n'));
  });
}

module.exports = {
  createChildLog,
  spawnElectronNode,
  waitForHttpOk,
  stopChild,
  watchUnexpectedExit,
  ensureBackendDistAssets,
  delay,
};
