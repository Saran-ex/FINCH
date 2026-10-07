const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Layout: <repo>/electron (this layer), <repo>/finch-backend, <repo>/tidy-files.
// Installed layout: <install>/resources/{backend,frontend,models,voices} with
// this layer's files inside app.asar (see electron-builder "files").
const electronRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(electronRoot, '..');

// Packaged apps ship the backend under <install>/resources/backend. In a dev
// run process.resourcesPath points at Electron's own resources folder, which
// never contains backend/dist, so this detects the installed layout without
// importing the electron module (keeps this file usable from plain Node).
const resourcesRoot = process.resourcesPath;
const packaged = Boolean(
  resourcesRoot &&
    fs.existsSync(path.join(resourcesRoot, 'backend', 'dist', 'index.js')),
);

const backendDir = packaged
  ? path.join(resourcesRoot, 'backend')
  : path.join(repoRoot, 'finch-backend');
const backendEntry = path.join(backendDir, 'dist', 'index.js');

const frontendDir = packaged
  ? path.join(resourcesRoot, 'frontend')
  : path.join(repoRoot, 'tidy-files');
const frontendEntry = path.join(frontendDir, '.output', 'server', 'index.mjs');
const frontendServerDir = path.dirname(frontendEntry);

// Packaged: app.asar/build (finch.ico is part of "files"); dev: electron/build.
const buildDir = path.join(electronRoot, 'build');

// The frontend hardcodes http://localhost:3001, so this port is fixed.
const BACKEND_PORT = 3001;
// First candidate for the UI server; skipped automatically when it is busy.
const RENDERER_PORT_CANDIDATE = 3000;

// Same default location the backend uses for its own logs (never overridden).
function logDir() {
  return process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Finch', 'logs')
    : path.join(os.homedir(), '.finch', 'logs');
}

function childLogPath() {
  return path.join(logDir(), 'electron-child.log');
}

// finch.ico is the intended app icon; favicon.ico is the pre-existing fallback
// so the window still has an icon before the branded files are dropped in.
function windowIcon() {
  for (const name of ['finch.ico', 'favicon.ico']) {
    const candidate = path.join(buildDir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

// Node flags for the backend child: register the "@" alias resolver first,
// because tsc leaves those specifiers untouched in dist/. The packaged dist is
// finalized at build time (scripts/finalize-dist.mjs) and contains no "@/"
// specifiers, so the hook is a dev-only safety net and is skipped when
// installed (it would also have to be read from inside the asar archive).
function backendAliasArgs() {
  if (packaged) return [];
  const register = path.join(electronRoot, 'lib', 'backend-alias-register.mjs');
  return ['--import', pathToFileURL(register).href];
}

module.exports = {
  electronRoot,
  repoRoot,
  packaged,
  backendDir,
  backendEntry,
  frontendDir,
  frontendEntry,
  frontendServerDir,
  buildDir,
  BACKEND_PORT,
  RENDERER_PORT_CANDIDATE,
  logDir,
  childLogPath,
  windowIcon,
  backendAliasArgs,
};
