import { Router } from "express";
import { getSetting, setSetting } from "../../../services/settingsService.js";
import { validateThemeBody } from "../../schemas/controlSchema.js";
import { logger } from "../../../services/logger.js";

const router = Router();

const DEFAULT_THEME = {
  theme: "light",
  accent: "#8b9dc3",
  glassIntensity: 60,
  reduceMotion: false,
};

router.get("/", (_req, res, next) => {
  try {
    const theme = getSetting("theme", DEFAULT_THEME);
    res.json(theme);
  } catch (err) {
    next(err);
  }
});

router.put("/", (req, res, next) => {
  try {
    const body = validateThemeBody(req.body);
    setSetting("theme", body);
    logger.info("theme updated", { theme: body });
    res.json(body);
  } catch (err) {
    next(err);
  }
});

export default router;
