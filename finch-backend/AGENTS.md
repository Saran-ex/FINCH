# Agent Rules

NEVER run these commands:
- npm run dev
- npx tsx src/index.ts
- node dist/index.js
- Anything with "tsx watch"
- Any command that starts a server

If a test needs a server, ask the user to start it in a separate terminal.
The user runs servers. You only edit files and run short commands.
