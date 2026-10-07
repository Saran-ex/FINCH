import { Router } from "express";
import themeRouter from "./theme.js";
import modesRouter from "./modes.js";
import modelsRouter from "./models.js";
import promptsRouter from "./prompts.js";
import memoryRouter from "./memory.js";
import researchResourcesRouter from "./research-resources.js";
import trustEntriesRouter from "./trust-entries.js";
import turnsRouter from "./turns.js";
import libraryRouter from "./library.js";

const router = Router();
router.use("/theme", themeRouter);
router.use("/modes", modesRouter);
router.use("/models", modelsRouter);
router.use("/library", libraryRouter);
router.use("/prompts", promptsRouter);
router.use("/research-resources", researchResourcesRouter);
router.use("/trust-entries", trustEntriesRouter);
router.use("/turns", turnsRouter);
router.use("/memory", memoryRouter);

export default router;
