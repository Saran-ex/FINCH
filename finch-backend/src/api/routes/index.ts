import { Router } from "express";
import healthRouter from "./health.js";
import turnRouter from "./turn.js";
import voiceRouter from "./voice.js";
import controlRouter from "./control/index.js";

const router = Router();
router.use("/health", healthRouter);
router.use("/api/turn", turnRouter);
router.use("/api/voice", voiceRouter);
router.use("/api/control", controlRouter);

export default router;
