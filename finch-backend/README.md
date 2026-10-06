# Finch Backend — Phase 1 (Foundation)

A clean, modular Node.js + TypeScript + Express + SQLite backend for Finch, a local AI companion.

## Quick Start

```bash
npm install
npm run dev
```

Server runs at `http://localhost:3001`

## Health Check

```bash
curl http://localhost:3001/health
```

Expected response:
```json
{
  "ok": true,
  "uptime": 4.2,
  "version": "0.1.0",
  "env": "development",
  "db": "connected",
  "timestamp": "2026-10-12T..."
}
```

## Database

SQLite database at `E:\Finch\finch-backend\data\finch.db` (created on first run).

Tables: `migrations`, `model_aliases`, `mode_settings`, `conversations`, `messages`, `summaries`, `memory_facts`, `prompts`, `settings`, `compaction_log`

## Phase

Phase 1 — Foundation only. No AI, no memory, no voice. Just a working server + database.