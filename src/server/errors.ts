export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly expose: boolean;

  constructor(statusCode: number, code: string, message: string, expose = true) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.expose = expose;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
