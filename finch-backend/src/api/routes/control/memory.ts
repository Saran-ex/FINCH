import { Router } from "express";
import { db } from "../../../db/client.js";
import {
  NotFoundError,
  ValidationError,
  ConflictError,
} from "../../../services/errors.js";
import { logger } from "../../../services/logger.js";
import {
  BatchNotFoundError,
  BatchStateError,
  confirmBatch,
  createPendingBatch,
  discardBatch,
  getPendingBatch,
  listConfirmedEntries,
} from "../../../memory/summarization/batchService.js";
import { getAlias } from "../../../models/registry.js";

const router = Router();

type SummarizeJobStatus = "running" | "done" | "failed";

interface SummarizeJob {
  jobId: string;
  status: SummarizeJobStatus;
  startedAt: string;
  batchId: number | null;
  error: string | null;
  skippedCount?: number;
  failedChunkCount?: number;
}

const summarizeJobs = new Map<string, SummarizeJob>();
let jobSeq = 0;

function toHttpError(err: unknown): unknown {
  if (err instanceof BatchNotFoundError) {
    return new NotFoundError(err.message);
  }
  if (err instanceof BatchStateError) {
    return new ConflictError(err.message);
  }
  return err;
}

function readBatchId(body: unknown): number {
  const parsed = body as { batchId?: unknown } | undefined;
  const batchId = parsed?.batchId;
  if (
    typeof batchId !== "number" ||
    !Number.isInteger(batchId) ||
    batchId <= 0
  ) {
    throw new ValidationError("batchId must be a positive integer");
  }
  return batchId;
}

function readModelAlias(body: unknown): string | undefined {
  const parsed = body as { model?: unknown } | undefined;
  const model = parsed?.model;
  if (model === undefined) return undefined;
  if (typeof model !== "string" || model.trim().length === 0) {
    throw new ValidationError("model must be a non-empty string");
  }
  const requested = model.trim();
  let alias: ReturnType<typeof getAlias>;
  try {
    alias = getAlias(requested);
  } catch {
    throw new ValidationError(`Unknown model '${requested}'`);
  }
  if (!alias.enabled) {
    throw new ValidationError(`Model '${requested}' is disabled`);
  }
  return alias.alias;
}

function jobView(job: SummarizeJob) {
  return {
    jobId: job.jobId,
    status: job.status,
    startedAt: job.startedAt,
    batchId: job.batchId,
    error: job.error,
  };
}

function isPositiveInt(v: string): boolean {
  return /^\d+$/.test(v) && parseInt(v, 10) > 0;
}

router.get("/", (_req, res, next) => {
  try {
    const rows = db
      .prepare(
        `SELECT
           c.id, c.title, c.mode, c.created_at, c.updated_at, c.archived,
           (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) AS message_count
         FROM conversations c
         WHERE c.archived = 0
         ORDER BY c.updated_at DESC
         LIMIT 100`,
      )
      .all() as Array<{
      id: number;
      title: string | null;
      mode: string;
      created_at: string;
      updated_at: string;
      archived: number;
      message_count: number;
    }>;

    res.json(
      rows.map((r) => ({
        id: r.id,
        title: r.title,
        mode: r.mode,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        archived: r.archived === 1,
        messageCount: r.message_count,
      })),
    );
  } catch (err) {
    next(err);
  }
});

router.post("/summarize", (req, res, next) => {
  try {
    const body = req.body as { days?: unknown } | undefined;
    const days = body?.days;
    if (days !== 7 && days !== 30) {
      throw new ValidationError("days must be 7 or 30");
    }
    const model = readModelAlias(req.body);

    for (const job of summarizeJobs.values()) {
      if (job.status === "running") {
        throw new ConflictError("A summarize job is already running");
      }
    }

    jobSeq += 1;
    const jobId = `job_${Date.now()}_${jobSeq}`;
    const job: SummarizeJob = {
      jobId,
      status: "running",
      startedAt: new Date().toISOString(),
      batchId: null,
      error: null,
    };
    summarizeJobs.set(jobId, job);
    logger.info("summarize job started", {
      jobId,
      days,
      model: model ?? "finch-3",
    });

    createPendingBatch(days, model)
      .then((result) => {
        job.batchId = result.batchId;
        job.skippedCount = result.skippedIds.length;
        job.failedChunkCount = result.failedChunks.length;
        job.status = "done";
        logger.info("summarize job finished", {
          jobId,
          batchId: result.batchId,
          entryCount: result.entries.length,
        });
      })
      .catch((err: unknown) => {
        job.status = "failed";
        job.error = err instanceof Error ? err.message : String(err);
        logger.error("summarize job failed", { jobId, error: job.error });
      });

    res.status(202).json({ jobId });
  } catch (err) {
    next(err);
  }
});

router.get("/summarize/status/:jobId", async (req, res, next) => {
  try {
    const jobId = req.params.jobId;
    const job = summarizeJobs.get(jobId);
    if (!job) {
      throw new NotFoundError(`Job ${jobId} not found`);
    }

    if (job.status === "done" && job.batchId !== null) {
      const preview = await getPendingBatch(job.batchId);
      res.json({
        ...jobView(job),
        preview,
        skippedIds: job.skippedCount ?? 0,
        failedChunks: job.failedChunkCount ?? 0,
      });
      return;
    }

    res.json(jobView(job));
  } catch (err) {
    next(err);
  }
});

router.post("/summarize/confirm", async (req, res, next) => {
  try {
    const batchId = readBatchId(req.body);
    const result = await confirmBatch(batchId);
    logger.info("memory batch confirmed", {
      batchId,
      deletedTotal: result.deletedTotal,
    });
    res.json(result);
  } catch (err) {
    next(toHttpError(err));
  }
});

router.post("/summarize/discard", async (req, res, next) => {
  try {
    const batchId = readBatchId(req.body);
    await discardBatch(batchId);
    logger.info("memory batch discarded", { batchId });
    res.json({ discarded: true, batchId });
  } catch (err) {
    next(toHttpError(err));
  }
});

router.get("/box", async (_req, res, next) => {
  try {
    const entries = await listConfirmedEntries();
    res.json(entries);
  } catch (err) {
    next(err);
  }
});

const MESSAGE_MODES = ["conversation", "plan", "search", "research"] as const;

router.get("/messages", (req, res, next) => {
  try {
    const mode = req.query.mode;
    if (
      typeof mode !== "string" ||
      !MESSAGE_MODES.includes(mode as (typeof MESSAGE_MODES)[number])
    ) {
      throw new ValidationError(
        `mode is required and must be one of: ${MESSAGE_MODES.join(", ")}`,
      );
    }

    let limit = 50;
    const limitRaw = req.query.limit;
    if (limitRaw !== undefined) {
      if (typeof limitRaw !== "string" || !/^\d+$/.test(limitRaw)) {
        throw new ValidationError("limit must be a positive integer");
      }
      limit = parseInt(limitRaw, 10);
      if (limit <= 0 || limit > 200) {
        throw new ValidationError(
          "limit must be a positive integer no greater than 200",
        );
      }
    }

    let hours = 24;
    const hoursRaw = req.query.hours;
    if (hoursRaw !== undefined) {
      if (typeof hoursRaw !== "string" || !/^\d+$/.test(hoursRaw)) {
        throw new ValidationError(
          "hours must be a positive integer no greater than 168",
        );
      }
      hours = parseInt(hoursRaw, 10);
      if (hours <= 0 || hours > 168) {
        throw new ValidationError(
          "hours must be a positive integer no greater than 168",
        );
      }
    }

    const rows = db
      .prepare(
        `SELECT id, mode, role, content, created_at
           FROM messages
          WHERE mode = ? AND created_at > datetime('now', ?)
          ORDER BY id DESC
          LIMIT ?`,
      )
      .all(mode, `-${hours} hours`, limit) as Array<{
      id: number;
      mode: string;
      role: string;
      content: string;
      created_at: string;
    }>;

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.delete("/messages/:id", (req, res, next) => {
  try {
    const idStr = req.params.id;
    if (!isPositiveInt(idStr)) {
      throw new ValidationError("id must be a positive integer");
    }
    const id = parseInt(idStr, 10);

    const exists = db.prepare("SELECT 1 FROM messages WHERE id = ?").get(id);
    if (!exists) throw new NotFoundError(`Message ${id} not found`);

    db.prepare("DELETE FROM messages WHERE id = ?").run(id);
    logger.info("message deleted", { id });

    res.json({ deleted: true, id });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", (req, res, next) => {
  try {
    const idStr = req.params.id;
    if (!isPositiveInt(idStr)) {
      throw new ValidationError("id must be a positive integer");
    }
    const id = parseInt(idStr, 10);

    const conv = db
      .prepare("SELECT * FROM conversations WHERE id = ?")
      .get(id) as
      | {
          id: number;
          title: string | null;
          mode: string;
          created_at: string;
          updated_at: string;
          archived: number;
        }
      | undefined;

    if (!conv) throw new NotFoundError(`Conversation ${id} not found`);

    const messages = db
      .prepare(
        `SELECT id, role, mode, content, model_alias, tokens_in, tokens_out, created_at
         FROM messages
         WHERE conversation_id = ?
         ORDER BY id ASC`,
      )
      .all(id) as Array<{
      id: number;
      role: string;
      mode: string;
      content: string;
      model_alias: string | null;
      tokens_in: number | null;
      tokens_out: number | null;
      created_at: string;
    }>;

    res.json({
      conversation: {
        id: conv.id,
        title: conv.title,
        mode: conv.mode,
        createdAt: conv.created_at,
        updatedAt: conv.updated_at,
        archived: conv.archived === 1,
      },
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        mode: m.mode,
        content: m.content,
        modelAlias: m.model_alias,
        tokensIn: m.tokens_in,
        tokensOut: m.tokens_out,
        createdAt: m.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", (req, res, next) => {
  try {
    const idStr = req.params.id;
    if (!isPositiveInt(idStr)) {
      throw new ValidationError("id must be a positive integer");
    }
    const id = parseInt(idStr, 10);

    const exists = db
      .prepare("SELECT 1 FROM conversations WHERE id = ?")
      .get(id);
    if (!exists) throw new NotFoundError(`Conversation ${id} not found`);

    db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
    logger.info("conversation deleted", { id });

    res.json({ deleted: true, id });
  } catch (err) {
    next(err);
  }
});

export default router;
