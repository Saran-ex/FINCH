import { Router, Request, Response } from "express";
import { db } from "@/db/client.js";
import { config } from "@/config/index.js";

const router = Router();

router.get("/", (_req: Request, res: Response) => {
  let dbStatus = "error";
  try {
    db.prepare("SELECT 1 AS ok").get();
    dbStatus = "connected";
  } catch { }
  res.json({
    ok: true,
    uptime: process.uptime(),
    version: "0.1.0",
    env: config.nodeEnv,
    db: dbStatus,
    timestamp: new Date().toISOString(),
  });
});

export default router;