import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Post-tsc build step that makes dist/ runnable on plain Node (zero dependencies):
// 1. rewrites tsconfig-paths aliases (e.g. "@/config/index.js") to file-relative specifiers
// 2. adds missing ".js" extensions to relative imports (moduleResolution: "bundler" output)
// Comments are masked before scanning, so comment text can never be rewritten.

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsconfigPath = path.join(backendRoot, "tsconfig.json");

let tsconfig;
try {
  tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf-8"));
} catch (error) {
  console.error(`[build] cannot parse ${tsconfigPath}: ${error.message}`);
  process.exit(1);
}

const { baseUrl = ".", paths = {}, outDir, rootDir } = tsconfig.compilerOptions ?? {};
if (!outDir || !rootDir) {
  console.error("[build] tsconfig must define compilerOptions.rootDir and compilerOptions.outDir");
  process.exit(1);
}

const distRoot = path.resolve(backendRoot, outDir);
const rootDirAbs = path.resolve(backendRoot, rootDir);
const baseDirAbs = path.resolve(backendRoot, baseUrl);
const FILE_EXTENSIONS = [".js", ".mjs", ".cjs", ".json"];
const KNOWN_EXTENSION = /\.(js|mjs|cjs|json)$/;

// First candidate of each tsconfig "paths" entry (first match wins, as in TypeScript).
const aliasPatterns = Object.entries(paths).map(([pattern, targets]) => {
  const target = Array.isArray(targets) ? targets[0] : targets;
  const starIndex = pattern.indexOf("*");
  const targetStarIndex = String(target ?? "").indexOf("*");
  return {
    prefix: starIndex === -1 ? pattern : pattern.slice(0, starIndex),
    suffix: starIndex === -1 ? "" : pattern.slice(starIndex + 1),
    targetPrefix: targetStarIndex === -1 ? String(target ?? "") : target.slice(0, targetStarIndex),
  };
});

// Static `from "..."` / `export ... from "..."` and dynamic `import("...")` specifiers.
const SPECIFIER_PATTERNS = [
  /(?<![$.\w])from\s*(["'])([^"'\n]+)\1/g,
  /\bimport\s*\(\s*(["'])([^"'\n]+)\1/g,
];

const stats = { aliases: 0, extensions: 0, files: 0 };

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

function fail(file, spec, line, reason) {
  const where = `${path.relative(backendRoot, file).split(path.sep).join("/")}:${line}`;
  console.error(`[build] ${where}: cannot rewrite specifier "${spec}" — ${reason}`);
  process.exit(1);
}

// Replaces comment content with spaces (same length) so match indices stay valid.
function maskComments(source) {
  const out = source.split("");
  let i = 0;
  let state = "code";
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (state === "code") {
      if (c === "/" && next === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        state = "line";
        continue;
      }
      if (c === "/" && next === "*") {
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        state = "block";
        continue;
      }
      if (c === "'" || c === '"' || c === "`") {
        state = { "'": "single", '"': "double", "`": "template" }[c];
      }
      i++;
      continue;
    }
    if (state === "line") {
      if (c === "\n") {
        state = "code";
      } else {
        out[i] = " ";
      }
      i++;
      continue;
    }
    if (state === "block") {
      if (c === "*" && next === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        state = "code";
        continue;
      }
      if (c !== "\n") out[i] = " ";
      i++;
      continue;
    }
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (
      (state === "single" && c === "'") ||
      (state === "double" && c === '"') ||
      (state === "template" && c === "`")
    ) {
      state = "code";
    }
    i++;
  }
  return out.join("");
}

function toRelativeSpecifier(fromDir, targetAbs) {
  const rel = path.relative(fromDir, targetAbs).split(path.sep).join("/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

function resolveAlias(file, spec, line) {
  const match = aliasPatterns.find(
    (p) =>
      spec.startsWith(p.prefix) &&
      spec.endsWith(p.suffix) &&
      spec.length >= p.prefix.length + p.suffix.length,
  );
  if (!match) {
    if (spec.startsWith("@/")) fail(file, spec, line, "no matching tsconfig paths entry");
    return null;
  }
  const rest = spec.slice(match.prefix.length, spec.length - match.suffix.length);
  const sourceAbs = path.resolve(baseDirAbs, match.targetPrefix + rest);
  const relToRoot = path.relative(rootDirAbs, sourceAbs);
  if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
    fail(file, spec, line, "alias resolves outside compilerOptions.rootDir");
  }
  let emitted = path.join(distRoot, relToRoot);
  if (!existsSync(emitted)) {
    const withExtension = FILE_EXTENSIONS.map((ext) => emitted + ext).find((c) => existsSync(c));
    if (withExtension) emitted = withExtension;
    else {
      const target = path.relative(backendRoot, emitted).split(path.sep).join("/");
      fail(file, spec, line, `no emitted file at ${target}`);
    }
  }
  return emitted;
}

function addExtension(fileDir, spec) {
  const abs = path.resolve(fileDir, spec);
  for (const ext of FILE_EXTENSIONS) {
    if (existsSync(abs + ext)) return spec + ext;
  }
  for (const ext of FILE_EXTENSIONS) {
    if (existsSync(path.join(abs, `index${ext}`))) {
      return `${spec.replace(/\/+$/, "")}/index${ext}`;
    }
  }
  return null;
}

function rewriteSpecifier(file, spec, line) {
  let out = spec;
  const aliasTarget = resolveAlias(file, spec, line);
  if (aliasTarget) {
    out = toRelativeSpecifier(path.dirname(file), aliasTarget);
    stats.aliases += 1;
  }
  if ((out.startsWith("./") || out.startsWith("../")) && !KNOWN_EXTENSION.test(out)) {
    const resolved = addExtension(path.dirname(file), out);
    if (!resolved) fail(file, spec, line, "no matching file for relative import");
    if (resolved !== out) {
      out = resolved;
      stats.extensions += 1;
    }
  }
  return out;
}

function* walkJavaScriptFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkJavaScriptFiles(full);
    else if (/\.(js|mjs|cjs)$/.test(entry.name)) yield full;
  }
}

if (!existsSync(distRoot)) {
  console.error(`[build] output folder missing: ${path.relative(backendRoot, distRoot)}`);
  process.exit(1);
}

for (const file of walkJavaScriptFiles(distRoot)) {
  const original = readFileSync(file, "utf-8");
  const masked = maskComments(original);
  const edits = [];
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const found of masked.matchAll(pattern)) {
      const spec = found[2];
      const line = lineOf(masked, found.index);
      const next = rewriteSpecifier(file, spec, line);
      if (next !== spec) {
        edits.push({
          start: found.index + found[0].indexOf(spec),
          text: next,
          length: spec.length,
        });
      }
    }
  }
  if (edits.length === 0) continue;
  edits.sort((a, b) => b.start - a.start);
  let updated = original;
  for (const edit of edits) {
    updated = updated.slice(0, edit.start) + edit.text + updated.slice(edit.start + edit.length);
  }
  writeFileSync(file, updated);
  stats.files += 1;
}

console.log(
  `[build] finalize-dist: ${stats.aliases} alias specifier(s) rewritten, ` +
    `${stats.extensions} extension(s) added, ${stats.files} file(s) changed`,
);
