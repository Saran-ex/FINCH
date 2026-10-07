import { db } from "@/db/client.js";
import { migrations } from "@/db/migrations/index.js";
import { logger } from "@/services/logger.js";

type MigrationRow = { name: string };

export function runMigrations(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    (db.prepare("SELECT name FROM migrations").all() as MigrationRow[]).map(
      (r) => r.name,
    ),
  );

  for (const m of migrations) {
    if (applied.has(m.name)) {
      logger.debug(`skip migration ${m.name}`);
      continue;
    }
    const tx = db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT INTO migrations (name) VALUES (?)").run(m.name);
    });
    tx();
    logger.info(`applied migration ${m.name}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations();
  logger.info("All migrations completed");
  process.exit(0);
}
