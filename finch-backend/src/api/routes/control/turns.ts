import { Router } from "express";
import { ValidationError } from "../../../services/errors.js";
import {
  getMostRecentTurnResult,
  listTurnResultsInRange,
  projectTurnForSummary,
} from "../../../services/turnResults.js";

const router = Router();

type TurnMode = "search" | "research";

function readQuery(
  rawMode: unknown,
  rawHours: unknown,
): { mode: TurnMode; hours: number } {
  if (rawMode !== "search" && rawMode !== "research") {
    throw new ValidationError("mode must be 'search' or 'research'");
  }

  let hours = 24;
  if (rawHours !== undefined) {
    if (typeof rawHours !== "string" || !/^\d+$/.test(rawHours)) {
      throw new ValidationError(
        "hours must be a positive integer no greater than 168",
      );
    }
    hours = parseInt(rawHours, 10);
    if (hours <= 0 || hours > 168) {
      throw new ValidationError(
        "hours must be a positive integer no greater than 168",
      );
    }
  }

  return { mode: rawMode, hours };
}

router.get("/recent", (req, res, next) => {
  try {
    const { mode, hours } = readQuery(req.query.mode, req.query.hours);

    const turn = getMostRecentTurnResult(mode, hours);

    if (!turn) {
      res.json({ turn: null });
      return;
    }

    res.json({
      turn: {
        conversationId: turn.conversationId,
        request: turn.request,
        reply: turn.reply,
        payload: turn.payload,
        createdAt: turn.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

const DAY_MS = 24 * 60 * 60 * 1000;

function readRange(
  rawFrom: unknown,
  rawTo: unknown,
): { from: string; to: string } {
  if (
    rawFrom !== undefined &&
    (typeof rawFrom !== "string" || rawFrom.length === 0)
  ) {
    throw new ValidationError("from and to must be non-empty strings");
  }
  if (
    rawTo !== undefined &&
    (typeof rawTo !== "string" || rawTo.length === 0)
  ) {
    throw new ValidationError("from and to must be non-empty strings");
  }

  const to = typeof rawTo === "string" ? rawTo : new Date().toISOString();
  const from =
    typeof rawFrom === "string"
      ? rawFrom
      : new Date(Date.now() - DAY_MS).toISOString();
  return { from, to };
}

router.get("/compact", (req, res, next) => {
  try {
    const { from, to } = readRange(req.query.from, req.query.to);

    const rows = listTurnResultsInRange(from, to);
    const turns = rows.map((row) => projectTurnForSummary(row));

    res.json({
      from,
      to,
      count: turns.length,
      turns,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
