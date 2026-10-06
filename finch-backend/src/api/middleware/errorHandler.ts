import { Request, Response, NextFunction } from "express";
import { isAppError } from "@/services/errors.js";
import { logger } from "@/services/logger.js";

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (isAppError(err)) {
    if (err.statusCode >= 500) {
      logger.error(err.message, { stack: err.stack, id: req.id });
    }
    res.status(err.statusCode).json({
      error: err.code,
      message: err.message,
      requestId: req.id,
    });
    return;
  }
  logger.error("unhandled", { err, id: req.id });
  res.status(500).json({ error: "INTERNAL_ERROR", message: "Something went wrong", requestId: req.id });
}