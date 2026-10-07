import { Request, Response, NextFunction } from "express";
import { logger } from "../../services/logger.js";

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = Date.now();
  logger.info("request", { id: req.id, method: req.method, url: req.url });
  res.on("finish", () => {
    logger.info("response", {
      id: req.id,
      method: req.method,
      url: req.url,
      status: res.statusCode,
      durationMs: Date.now() - start,
    });
  });
  next();
}
