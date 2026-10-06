import { Router } from "express";
import { db } from "../../../db/client.js";
import { savePrompt, loadPrompt } from "../../../modes/prompts.js";
import { validatePromptBody } from "../../schemas/controlSchema.js";
import { ensureValidMode } from "../../../modes/validation.js";
import { MODES } from "../../../config/constants.js";
import { getModeConfig } from "../../../config/modeConfig.js";
import { NotFoundError, ValidationError } from "../../../services/errors.js";
import { logger } from "../../../services/logger.js";

const router = Router();

router.get("/", (_req, res, next) => {
  try {
    const rows = db
      .prepare(
        "SELECT mode, system_prompt, updated_at FROM prompts ORDER BY mode"
      )
      .all() as Array<{
      mode: string;
      system_prompt: string;
      updated_at: string;
    }>;

    const byMode = new Map(rows.map((r) => [r.mode, r]));

    // Always return all four modes; missing/empty rows fall back to the modeConfig default.
    res.json(
      MODES.map((mode) => {
        const row = byMode.get(mode);
        if (row && row.system_prompt.trim().length > 0) {
          return { mode, systemPrompt: row.system_prompt, updatedAt: row.updated_at };
        }
        return {
          mode,
          systemPrompt: getModeConfig(mode).systemPrompt,
          updatedAt: row?.updated_at ?? null,
        };
      })
    );
  } catch (err) {
    next(err);
  }
});

router.put("/:mode", (req, res, next) => {
  try {
    const mode = ensureValidMode(req.params.mode);
    const { systemPrompt } = validatePromptBody(req.body);

    savePrompt(mode, systemPrompt);
    const updated = loadPrompt(mode);

    logger.info("prompt updated", { mode });
    res.json({ mode, systemPrompt: updated, updatedAt: new Date().toISOString() });
  } catch (err) {
    if (err instanceof NotFoundError) {
      next(new ValidationError(err.message));
    } else {
      next(err);
    }
  }
});

router.post("/:mode/reset", (req, res, next) => {
  try {
    const mode = ensureValidMode(req.params.mode);
    const defaultPrompt = getModeConfig(mode).systemPrompt;

    savePrompt(mode, defaultPrompt);

    logger.info("prompt reset to default", { mode });
    res.json({
      mode,
      systemPrompt: defaultPrompt,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;