import { PROBLEM_CODES, type ProblemCode } from '@archova/contracts';

export interface FieldError {
  path: string;
  message: string;
}

/**
 * Typed application error. Thrown anywhere; mapped to RFC 9457 problem+json only in the API layer
 * (conventions §Code quality). `code` is a stable string from @archova/contracts PROBLEM_CODES.
 */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ProblemCode,
    message?: string,
    readonly errors?: FieldError[],
    readonly extra?: Record<string, unknown>,
  ) {
    super(message ?? code);
    this.name = 'AppError';
    this.status = PROBLEM_CODES[code];
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;

export const notFound = (code: ProblemCode = 'not_found', message?: string) =>
  new AppError(code, message);
export const forbidden = (message?: string, extra?: Record<string, unknown>) =>
  new AppError('access.denied', message, undefined, extra);
export const versionConflict = () =>
  new AppError(
    'version_conflict',
    'The resource was changed by someone else. Reload and try again.',
  );
