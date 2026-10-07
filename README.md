# Finch

A local-first AI companion that lives on your own computer — talk, plan, search, and research with it, without sending your life to someone else's cloud.

## Story

It started with a movie. Watching *Finch*, the idea that stuck was not the robot's hardware — it was the relationship: a companion that learns, communicates, helps, and is simply there. Finch (the app) is a small beginning toward that idea: a personal AI companion that runs on your own machine, stays as local as possible, and gives you control over how it works. Version 1 is not meant to be perfect — it's the start of an experiment to see how far a personal, local companion can grow.

## Features

- **Conversation** — talk with Finch by voice, with memory of your past conversations.
- **Plan** — structured planning and explanations with a live typing effect.
- **Search** — web search with ranked sources, plain-language answers, and topic cards.
- **Research** — deeper dives across arXiv, OpenAlex, Europe PMC, and Wikipedia, with trusted-site search and research cards.
- **Control Room** — settings for theme, modes, organizer models, memory, prompts, and resources, plus a memory box that summarizes old conversations.
- **Fully offline AI and speech** — language models run locally via [Ollama](https://ollama.com); speech-to-text runs locally via whisper.cpp; text-to-speech runs locally via Kokoro / Kitten voices (sherpa-onnx) with a Piper fallback. Search and Research modes fetch public web sources; everything else stays on your machine.

## Why local-first

Your conversations, memories, and voice never leave your computer. There is no account, no subscription, and no telemetry pipeline — the models, the SQLite database, and the logs all live in your own home folder (`%LOCALAPPDATA%\Finch` for the installed app). If you can unplug the network cable and still talk to Finch, that is the point.

## System requirements

- **OS:** Windows 10 / 11, 64-bit
- **RAM:** 8 GB minimum
- **GPU:** not required — inference and speech both run on CPU
- **Disk:** the installer download is ~705 MB and installs to ~1.2 GB; keep ~3 GB free for the app, its database, and logs. Ollama models need extra space on top (roughly 1–3 GB per model, stored by Ollama itself).

## Quick start (regular users)

1. Download **`Finch Setup 1.0.0.exe`** from [GitHub Releases](../../releases).
2. Run it and choose **"only for me"** when asked — Finch installs per-user, no admin rights needed.
3. Windows SmartScreen will warn about an **unknown publisher**. That is expected for this unsigned build and safe to bypass (More info → Run anyway).
4. Install [Ollama](https://ollama.com) separately, then pull the models Finch uses (the 1.5B one is the default voice/chat model; the 3B one powers Research, memory summaries, and fallback):
   ```powershell
   ollama pull qwen2.5:1.5b
   ollama pull qwen2.5:3b
   ```
   Optional extras you can enable later from the Control Room: `ollama pull qwen3:1.7b` and `ollama pull gemma3:4b`.
5. Launch Finch from the Start menu or desktop shortcut and start talking.

Uninstalling keeps `%LOCALAPPDATA%\Finch` in place, so reinstalling never wipes your memories.

## Architecture

Three processes, one supervisor. The Electron shell (`electron/main.js`) starts first, finds two free loopback ports, then spawns and watches two children with `process.execPath` plus `ELECTRON_RUN_AS_NODE=1` (see `electron/lib/services.js` → `spawnElectronNode`):

```
┌─────────────────────────────────────────────────────────┐
│ Finch.exe (Electron main: window + supervision)          │
│  ├─ UI server ......... frontend/.output/server/index.mjs│
│  │                       Nitro, PORT=<free port from 3000>
│  │                       HOST=127.0.0.1, NODE_ENV=production
│  └─ Backend ........... backend/dist/index.js            │
│                          Express, PORT=3001 (fixed)      │
│                          cwd=<...>/resources/backend     │
│                          CORS_ORIGIN=http://localhost:<ui-port>
└─────────────────────────────────────────────────────────┘
         │                                  │
         │  BrowserWindow                   │  http://localhost:3001
         ▼                                  ▼
   rendered UI  ◄──── fetch/BASE_URL ────  JSON API + WAV audio
```

- **Backend** (`finch-backend/`, TypeScript → `dist/`): Express API for turns (`POST /api/turn`, streaming `POST /api/turn/stream`), voice (`/api/voice/transcribe`, `/api/voice/speak`), and Control Room endpoints (`/api/control/*`). It shells out to `whisper-cli.exe` for speech-to-text and `piper.exe` for fallback TTS, and runs Kokoro/Kitten synthesis on worker threads (`kokoro-tts-worker.mjs`, `kitten-tts-worker.mjs` via `src/services/tts-kokoro.ts` / `tts-kitten.ts`). It binds `127.0.0.1:3001` always — a second copy refuses to start if the port is taken.
- **Frontend** (`tidy-files/`, React 19 + TanStack Start): server-rendered by Nitro in production, plain Vite dev server (`:8080`) in development. It calls the backend at a hardcoded `http://localhost:3001` (`src/lib/api.ts` → `BASE_URL`), so the backend port is part of the contract.
- **Shell** (`electron/`): picks ports (`lib/ports.js`), resolves the installed-vs-repo layout (`lib/paths.js`), copies migration SQL into `dist/` on first run, tails child output to `%LOCALAPPDATA%\Finch\logs\electron-child.log`, probes Ollama every 15s for the not-running banner (`lib/ollama.js`), and kills whole process trees on exit.
- **Ollama** is the fourth, external piece: an `ollama serve` instance on `http://localhost:11434` does all language-model inference (`/api/generate`). Finch never bundles it.

In development the same three pieces run from source instead: `tsx watch src/index.ts` (backend, `:3001`), `vite dev` (frontend, `:8080`), and optionally `electron .` as the shell.

## External dependencies (not in git — fetch these yourself)

`models/` and `voices/` are git-ignored (~749 MB). Everything below is resolved through `findAssetRoot()` in `finch-backend/src/config/env.ts`: the first of `<backend>/..`, `<backend>`, or `process.cwd()` that contains a `models/` or `voices/` folder wins — i.e. the **repo root** in development, `resources/` in the installed app. Every path below is relative to that asset root and overridable via the matching env var.

| What | Exact files on disk | Source |
|---|---|---|
| Ollama server | installer from <https://ollama.com> | <https://ollama.com> |
| Default chat/voice model | `ollama pull qwen2.5:1.5b` (alias `finch-1.5`) | Ollama library |
| Research / summaries / fallback | `ollama pull qwen2.5:3b` (alias `finch-3`) | Ollama library |
| Optional models | `ollama pull qwen3:1.7b` (`finch-1.7`), `ollama pull gemma3:4b` (`finch-4`) | Ollama library |
| Whisper transcription + wake word | `models/ggml-base.en-q5_1.bin` (57 MB, used for both) | <https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en-q5_1.bin> |
| Whisper spare model | `models/ggml-small.en-q5_1.bin` (181 MB, shipped but not referenced by current code) | <https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q5_1.bin> |
| whisper.cpp binaries | `models/whisper/Release/whisper-cli.exe` + `ggml-*.dll` | <https://github.com/ggml-org/whisper.cpp/releases> |
| Kokoro voice (default TTS) | `voices/kokoro/kokoro-v1.0.int8.sherpa.onnx`, `voices.bin`, `tokens.txt` | Model: <https://huggingface.co/hexgrad/Kokoro-82M>; sherpa builds: <https://github.com/k2-fsa/sherpa-onnx> *(confirm exact files)* |
| Kitten voice | `voices/kitten/kitten_tts_nano_v0_8.sherpa.onnx`, `voices.bin`, `tokens.txt` | <https://huggingface.co/KittenML/Kitten-TTS> *(confirm exact files)* |
| Piper fallback | `voices/piper/piper/piper.exe` (+ DLLs), `voices/en_US-lessac-high.onnx` (+ `.json`) | Runtime: <https://github.com/rhasspy/piper/releases>; voices: <https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US/lessac/high> |
| Shared phonemizer data | `voices/piper/piper/espeak-ng-data/` (used by Piper, Kokoro, and Kitten) | ships with the Piper release above |

(The two Whisper links are verified — their published byte sizes match the bundled files exactly. Override any path with `WHISPER_EXE`, `WHISPER_MODEL`, `WHISPER_WAKE_MODEL`, `PIPER_EXE`, `PIPER_VOICE`, `KOKORO_MODEL`, `KOKORO_VOICES`, `KOKORO_TOKENS`, `KOKORO_ESPEAK_DATA`, `KITTEN_MODEL`, `KITTEN_VOICES`, `KITTEN_TOKENS`, or `TTS_ENGINE=kokoro|kitten|piper` in `finch-backend/.env`.)

## Database

SQLite via `better-sqlite3`, synchronous and file-local — no database server to install.

- **Packaged app:** `%LOCALAPPDATA%\Finch\data\finch.db` (override with `DB_PATH`; logs go to `%LOCALAPPDATA%\Finch\logs` or `LOG_DIR`). Falls back to `~/.finch` when `LOCALAPPDATA` is unset.
- **Migrations** live in `finch-backend/src/db/migrations/` (`001_initial.sql` … `005_*`, `007_memory_box.sql`, `008_seed_additional_aliases.sql`, `009` … `017_*`, plus `index.ts`) and run automatically at backend startup via `runMigrations()` — the same seed also registers the `finch-1.5/3/1.7/4` model aliases, per-mode defaults, and system prompts. The production build copies the `.sql` files next to the compiled output (`scripts/copy-migrations.mjs`) because `tsc` emits no non-TS assets.

## Build from source

Prerequisites: **Node.js 20+ (22 LTS recommended — developed with v22.14.0 / npm 11.4.2)**, npm, and Ollama with the models from Quick Start. Clone the repo, then per folder:

```bash
git clone <your-finch-repo-url> && cd Finch

# 1. Backend API (http://127.0.0.1:3001)
cd finch-backend
npm install
cp .env.example .env   # optional; defaults work. Full variable list:
                       # PORT NODE_ENV LOG_LEVEL DB_PATH LOG_DIR OLLAMA_URL
                       # CORS_ORIGIN WHISPER_EXE WHISPER_MODEL WHISPER_WAKE_MODEL
                       # PIPER_EXE PIPER_VOICE TTS_ENGINE AI_STREAM
                       # VOICE_PIPELINE_MODE KOKORO_* KITTEN_* (see src/config/env.ts)
npm run dev            # tsx watch src/index.ts

# 2. Frontend (http://localhost:8080) — second terminal
cd ../tidy-files
npm install
npm run dev            # vite dev

# 3. Desktop shell (optional third terminal — supervises the two above
#    from source instead of installed builds)
cd ../electron
npm install
npm start              # electron .
```

Run backend first, then frontend; the shell can be added on top. The frontend hardcodes the backend at `http://localhost:3001`, so keep that port free.

Production builds and the installer (the real Stage 3 pipeline, in this order):

```bash
cd finch-backend && npm run build   # tsc && finalize-dist.mjs (alias/extension rewrite) && copy-migrations.mjs
cd ../tidy-files && npm run build   # vite build → .output/ (Nitro server + client assets)
cd ../electron && npm run package   # node --check ... && stage-backend-deps.mjs (prod node_modules closure)
                                    # && electron-builder --win nsis --publish never
```

The installer lands in `electron/installer-output/` (~705 MB: backend `dist/` + production `node_modules`, the two TTS worker `.mjs` files, the frontend `.output/`, and the full `models/` + `voices/` folders). Note `electron/build/backend-package.json` (`{"type": "module"}`) ships as `backend/package.json` — without it, Node would load the compiled ESM backend as CommonJS depending on where the app is installed.

## Project structure

```
E:\Finch
├── finch-backend/            Express + TypeScript + SQLite API (package.json: build = tsc + finalize + migrations)
│   ├── kokoro-tts-worker.mjs / kitten-tts-worker.mjs   TTS worker threads (spawned, not imported)
│   ├── scripts/              finalize-dist.mjs, copy-migrations.mjs
│   └── src/
│       ├── ai/               turnService.ts (mode routing: conversation/plan/search/research)
│       ├── api/routes/       index.ts, turn.ts, voice.ts (/transcribe, /speak), health.ts, control/
│       ├── config/           env.ts (all paths + overrides + findAssetRoot), modeConfig.ts
│       ├── db/               client.ts, migrate.ts, migrations/*.sql
│       ├── memory/           conversation service + repositories/ + summarization/
│       ├── models/           ollamaAdapter.ts, registry.ts (finch-* aliases), ollamaLibrary.ts
│       ├── modes/            per-mode behaviour
│       ├── search/           routers/clients (searxng, wikipedia, arxiv, openAlex, europePmc),
│       │                     answerBuilder.ts, cardBuilder.ts, queryRewriter.ts, image fetchers
│       ├── services/         voice.ts (engine picker + Piper fallback), tts-kokoro.ts,
│       │                     tts-kitten.ts, logger.ts, settingsService.ts, …
│       └── types/
├── tidy-files/               React 19 + TanStack Start UI (vite dev :8080, Nitro server in prod)
│   └── src/
│       ├── routes/           __root.tsx, index.tsx (main screen), control-room.tsx
│       ├── modes/            ConversationMode.tsx, PlanMode.tsx, SearchMode.tsx, ResearchMode.tsx
│       ├── components/       control-room/ (Theme/Modes/Organizer/Memory/Prompts/Resources/About panels),
│       │                     finch/ (voice + results UI), ui/ (Radix primitives), react-bits/
│       ├── lib/              api.ts (BASE_URL http://localhost:3001), stores, cardMapping.ts
│       ├── hooks/  assets/  types/
│       └── public/           finch.ico (official icon), favicon.ico
├── electron/                 Desktop shell + packaging (npm run package)
│   ├── main.js               window + child supervision + Ollama monitor
│   ├── lib/                  paths.js, ports.js, services.js (spawnElectronNode),
│   │                         ollama.js (not-running banner probe), backend-alias-*.mjs (dev only)
│   ├── scripts/              stage-backend-deps.mjs (production node_modules closure)
│   └── build/                finch.ico (committed branding), backend-package.json (ESM marker)
├── models/                   NOT in git — ggml Whisper models + whisper.cpp Release binaries
└── voices/                   NOT in git — Kokoro/Kitten/Piper models, voices, espeak-ng-data
```

## Tech stack

| Layer | Technology |
|---|---|
| Desktop shell / installer | Electron 38.8.6, electron-builder 26 (NSIS, per-user) |
| Backend | TypeScript 5.5, Express 4.19, SQLite via better-sqlite3 13, tsx 4 (dev) |
| Frontend | React 19.2, TanStack Start / Router / Query, Tailwind CSS 4, Vite 8 |
| Language models | Ollama (external server): `qwen2.5:1.5b` default, `qwen2.5:3b` for research/summaries, optional `qwen3:1.7b`, `gemma3:4b` |
| Speech-to-text | whisper.cpp CLI binaries + local ggml models (base for transcription and wake word) |
| Text-to-speech | Kokoro-82M and Kitten TTS Nano via sherpa-onnx-node 1.13.8, with a local Piper fallback |
| Web sources | Wikipedia, arXiv, OpenAlex, Europe PMC APIs |

## Troubleshooting

- **SmartScreen "unknown publisher" on install** — expected for this unsigned build; More info → Run anyway. The installer only writes its program folder plus shortcuts; your data folder is never touched on install or uninstall.
- **"Ollama is not running. Start Ollama to chat with Finch." banner** — the shell probes `http://localhost:11434/` every 15 seconds. Start `ollama serve` (or the Ollama app) and pull at least `qwen2.5:1.5b`. The Control Room → Organizer page shows the same state as "Ollama is not responding" with an empty model list.
- **"Backend unreachable" / FINCH OFFLINE in the UI** — the backend binds fixed `127.0.0.1:3001`. Close other Finch instances (or anything else on :3001) and restart; backend logs are at `%LOCALAPPDATA%\Finch\logs`.
- **Reply arrives but spoken by the Piper voice instead of Kokoro/Kitten** — any model-engine failure falls back to Piper automatically (the reason is logged, spaces slugified, e.g. `reason=Kokoro_synthesis_failed:...`). Check that the Kokoro/Kitten model files from the table above are in place and set `LOG_LEVEL=debug` for the full error.
- **Search answers take minutes on a slow CPU** — Search runs up to three sequential Ollama calls (rewrite, answer, cards) on Ollama's single-file queue; overlapping turns serialize. This is inherent, not an install problem: wait it out or retry once the turn finishes.

## License

MIT License — SARAN, 2026. See [LICENSE](./LICENSE).

## Status

Version **1.0.0** — actively developed. The app works end to end (voice, text, search, research, memory); expect rough edges and improving performance. Feedback and bug reports via GitHub Issues are welcome.
