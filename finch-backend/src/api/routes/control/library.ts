import { Router } from "express";
import { syncModelLibrary, setModelLibraryEnabled } from "../../../services/modelLibrary.js";
import { validateLibraryBody } from "../../schemas/controlSchema.js";

const router = Router();

// GET /api/control/library — every model Ollama currently has installed, plus
// its enabled flag. The list comes from Ollama's /api/tags, never from a
// hard-coded table, so a freshly pulled model shows up on the next request.
router.get("/", async (_req, res, next) => {
  try {
    res.json(await syncModelLibrary());
  } catch (err) {
    next(err);
  }
});

// PUT /api/control/library — tick/untick a model. Unticking only hides it from
// the mode pickers; the model stays on the machine and in the database.
router.put("/", (req, res, next) => {
  try {
    const { alias, enabled } = validateLibraryBody(req.body);
    res.json(setModelLibraryEnabled(alias, enabled));
  } catch (err) {
    next(err);
  }
});

export default router;
