// ESM resolve hook for the backend child, registered by
// backend-alias-register.mjs (loaded with `node --import`).
//
// tsc emits two things plain Node cannot load, because tsconfig uses
// moduleResolution "bundler":
//   1. "@/..." path aliases (tsc never rewrites tsconfig paths)
//   2. extensionless relative imports such as "./memoryCheck"
// `npm run dev` (tsx) resolves both at load time; this hook does the same for
// the compiled dist output, without touching the backend.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// <electron>/lib -> <repo>/finch-backend/dist
const BACKEND_DIST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'finch-backend',
  'dist',
);

// Returns the first real file among: as-is, +.js/.mjs/.cjs/.json, /index.js.
function existingFile(target) {
  const candidates = [
    target,
    `${target}.js`,
    `${target}.mjs`,
    `${target}.cjs`,
    `${target}.json`,
    path.join(target, 'index.js'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return '';
}

function aliasTarget(specifier) {
  const target = path.join(BACKEND_DIST, specifier.slice(2));
  // Fall back to the unmapped path so Node's own error names a real location.
  return existingFile(target) || target;
}

function extensionlessRelativeTarget(specifier, parentURL) {
  if (!parentURL) return '';
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return '';
  try {
    const base = new URL(specifier, parentURL);
    if (base.protocol !== 'file:') return '';
    return existingFile(fileURLToPath(base));
  } catch {
    return '';
  }
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    return nextResolve(pathToFileURL(aliasTarget(specifier)).href, context);
  }

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const retry = extensionlessRelativeTarget(specifier, context.parentURL);
    if (!retry) throw error;
    return nextResolve(pathToFileURL(retry).href, context);
  }
}
