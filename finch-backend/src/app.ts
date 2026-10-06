import express from "express";
import cors from "cors";
import { config } from "@/config/index.js";
import { requestId } from "@/api/middleware/requestId.js";
import { requestLogger } from "@/api/middleware/logger.js";
import { errorHandler } from "@/api/middleware/errorHandler.js";
import routes from "@/api/routes/index.js";
import { NotFoundError } from "@/services/errors.js";

const app = express();
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (config.corsOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));
// Arrival timestamp, captured before any body parsing so routes can log how
// long an upload took (voice timing logs only — nothing else reads this).
app.use((_req, res, next) => {
  res.locals.receivedAt = Date.now();
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use(requestId);
app.use(requestLogger);
app.use("/", routes);
app.use((_req, _res, next) => next(new NotFoundError("Route not found")));
app.use(errorHandler);
export default app;