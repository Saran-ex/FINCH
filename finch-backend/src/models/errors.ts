import { AppError } from "../services/errors.js";

export class ModelUnavailableError extends AppError {
  constructor(alias: string, cause?: unknown) {
    super(`Model ${alias} is unavailable`, 502, "MODEL_UNAVAILABLE", { cause });
  }
}

export class ModelTimeoutError extends AppError {
  constructor(alias: string) {
    super(`Model ${alias} timed out`, 504, "MODEL_TIMEOUT");
  }
}

export class ModelResponseError extends AppError {
  constructor(alias: string, message: string) {
    super(`Model ${alias} returned invalid response: ${message}`, 502, "MODEL_RESPONSE_INVALID");
  }
}