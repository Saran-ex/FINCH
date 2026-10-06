# Finch

Local AI companion: an Express/SQLite backend (`finch-backend/`) and a web UI (`tidy-files/`).

```
E:\Finch
├── finch-backend/   Node.js + TypeScript + Express + SQLite API
├── tidy-files/      React frontend
├── models/          NOT in git — speech-to-text models + whisper.cpp binaries
└── voices/          NOT in git — text-to-speech voices + piper binaries
```

## Large model & voice files (not included in this repository)

`models/` and `voices/` are **ignored by git on purpose**. Together they are
**749 MB across 415 files**, and two of them are larger than GitHub's 100 MB
per-file limit, so they cannot be pushed:

| File | Size | What it is |
|---|---|---|
| `models/ggml-small.en-q5_1.bin` | 181 MB | Whisper **small** English speech-to-text model (ggml, Q5_1 quantised) — used for real transcription |
| `models/ggml-base.en-q5_1.bin` | 57 MB | Whisper **base** English speech-to-text model (ggml, Q5_1 quantised) — used for the wake word |
| `voices/en_US-lessac-high.onnx` (+ `.json`) | 109 MB | **Piper** `en_US-lessac-high` voice — default text-to-speech engine |
| `voices/kokoro/` | 230 MB | **Kokoro-82M** TTS model (int8 + sherpa-onnx variants) |
| `voices/kitten/` | 115 MB | **Kitten TTS Nano v0.8** TTS model |
| `voices/piper/` | 37 MB | Piper runtime (`piper.exe`, DLLs) and `espeak-ng-data` phonemizer data |
| `models/whisper/Release/` | 18 MB | whisper.cpp Windows binaries (`whisper-cli.exe`, `ggml-*.dll`) |

### Where to download them

> The exact URLs used originally were **not recorded anywhere in this repo**,
> so please confirm these match what you downloaded before relying on them.

| Folder / file | Source |
|---|---|
| `voices/en_US-lessac-high.onnx` | Piper voices — <https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US/lessac/high> |
| `voices/piper/piper/piper.exe` | Piper releases — <https://github.com/rhasspy/piper/releases> |
| `voices/kokoro/kokoro-v1.0.int8.onnx` | <https://huggingface.co/hexgrad/Kokoro-82M> |
| `voices/kokoro/*.sherpa.onnx` | sherpa-onnx builds — <https://github.com/k2-fsa/sherpa-onnx> *(confirm exact files)* |
| `voices/kitten/kitten_tts_nano_v0_8.onnx` | <https://huggingface.co/KittenML/Kitten-TTS> *(confirm exact files)* |
| `models/whisper/Release/` | whisper.cpp releases — <https://github.com/ggml-org/whisper.cpp/releases> |
| `models/ggml-*-q5_1.bin` | whisper.cpp-format ggml models from the Hugging Face Hub *(fill in the exact links you used)* |

**They must be restored at these exact paths** — the backend config points at them
by absolute path (`E:\Finch\models\...`, `E:\Finch\voices\...`). You can override
any of them in `finch-backend/.env` with `WHISPER_EXE`, `WHISPER_MODEL`,
`WHISPER_WAKE_MODEL`, `PIPER_EXE`, `PIPER_VOICE`, `KOKORO_ESPEAK_DATA`, `TTS_ENGINE`.

## Getting started

### Backend

```bash
cd finch-backend
npm install
cp .env.example .env   # then edit as needed
npm run dev
```

Server runs at `http://localhost:3001` — health check: `curl http://localhost:3001/health`

The SQLite database is created at `finch-backend/data/finch.db` on first run.
That folder, `.env`, logs and the backup scratch folders are git-ignored because
they contain local/personal data.

### Frontend

```bash
cd tidy-files
npm install
npm run dev
```

## Not in this repository

- `models/`, `voices/` — see above
- `finch-backend/data/` — SQLite database and DB backups (personal data)
- `finch-backend/.env` — secrets (`.env.example` is committed as a template)
- `logs/`, `*.log`, `dist/`, `build/`, `node_modules/`
