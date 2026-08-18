export type ErrorCode =
  | "INVALID_INPUT"
  | "PROCESS_NOT_FOUND"
  | "PORT_NOT_FOUND"
  | "PROJECT_NOT_FOUND"
  | "PERMISSION_DENIED"
  | "UNSUPPORTED_PLATFORM"
  | "TIMEOUT"
  | "DEPENDENCY_UNAVAILABLE"
  | "INTERNAL_ERROR"
  | "CONFIRMATION_REQUIRED"
  | "NOT_IMPLEMENTED";

export class AirCtlError extends Error {
  readonly code: ErrorCode;
  readonly exitCode: number;
  readonly causeError?: unknown;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown; exitCode?: number }) {
    super(message);
    this.name = "AirCtlError";
    this.code = code;
    this.causeError = options?.cause;
    this.exitCode = options?.exitCode ?? exitCodeFor(code);
  }
}

export function exitCodeFor(code: ErrorCode): number {
  switch (code) {
    case "INVALID_INPUT":
      return 2;
    case "PROCESS_NOT_FOUND":
    case "PORT_NOT_FOUND":
    case "PROJECT_NOT_FOUND":
      return 3;
    case "PERMISSION_DENIED":
      return 4;
    case "CONFIRMATION_REQUIRED":
      return 5;
    case "UNSUPPORTED_PLATFORM":
    case "DEPENDENCY_UNAVAILABLE":
    case "NOT_IMPLEMENTED":
      return 6;
    case "TIMEOUT":
      return 7;
    default:
      return 1;
  }
}

export function isAirCtlError(error: unknown): error is AirCtlError {
  return error instanceof AirCtlError;
}

export function toErrorPayload(
  error: unknown,
  requestId?: string,
): {
  error: { code: string; message: string; requestId?: string };
} {
  if (isAirCtlError(error)) {
    return {
      error: {
        code: error.code,
        message: error.message,
        ...(requestId ? { requestId } : {}),
      },
    };
  }
  return {
    error: {
      code: "INTERNAL_ERROR",
      message: "An internal error occurred.",
      ...(requestId ? { requestId } : {}),
    },
  };
}
