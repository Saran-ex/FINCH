export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly code: string = "INTERNAL_ERROR",
    public readonly meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super(message, 404, "NOT_FOUND", meta);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super(message, 400, "VALIDATION_ERROR", meta);
    this.name = "ValidationError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super(message, 409, "CONFLICT", meta);
    this.name = "ConflictError";
  }
}

export class ModelError extends AppError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super(message, 502, "MODEL_ERROR", meta);
    this.name = "ModelError";
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
