// Loaded by the backend child process via `node --import <this file>`.
//
// tsc does not rewrite tsconfig "paths" in the emitted JavaScript, so every
// dist module still imports "@/..." which plain Node cannot resolve (it looks
// for an npm package named "@/config"). `npm run dev` works because tsx
// resolves those aliases at load time; this hook does the same for the
// compiled dist output, without touching the backend.
import { register } from 'node:module';

register(new URL('./backend-alias-resolver.mjs', import.meta.url).href);
