import app from "./app.js";
import { config } from "@/config/index.js";
import { runMigrations } from "@/db/migrate.js";
import { closeDb } from "@/db/client.js";
import { logger } from "@/services/logger.js";

logger.info("Finch backend starting...");
runMigrations();

const server = app.listen(config.port, "127.0.0.1", () => {
  logger.info(`Finch backend listening on http://127.0.0.1:${config.port}`);
  logger.info(`Server address: ${JSON.stringify(server.address())}`);
});

// Keep the process alive (prevents exit on some Node/Windows configurations)
const keepAlive = setInterval(() => {}, 1000 * 60 * 60);

function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down...`);
  clearInterval(keepAlive);
  server.close(() => {
    closeDb();
    logger.info("Shutdown complete");
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (err) => {
  logger.error("uncaughtException", { err });
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  logger.error("unhandledRejection", { err });
  process.exit(1);
});