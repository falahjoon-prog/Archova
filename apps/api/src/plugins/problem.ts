import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError, currentRequestContext } from '@archova/kernel';

/** RFC 9457 problem+json for every error (api.md §3). Only the API layer maps errors to HTTP. */
export function problemBody(
  status: number,
  code: string,
  title: string,
  extra: Record<string, unknown> = {},
) {
  return {
    type: `urn:archova:problem:${code}`,
    title,
    status,
    code,
    traceId: currentRequestContext()?.requestId,
    ...extra,
  };
}

export function registerProblemHandler(app: FastifyInstance) {
  app.setNotFoundHandler((_req, reply) => {
    void reply
      .status(404)
      .type('application/problem+json')
      .send(problemBody(404, 'not_found', 'Not found'));
  });

  app.setErrorHandler((error: FastifyError | AppError | ZodError | Error, req, reply) => {
    if (error instanceof AppError) {
      const extra: Record<string, unknown> = { ...(error.extra ?? {}) };
      if (error.errors) extra.errors = error.errors;
      if (error.status >= 500) req.log.error({ err: error }, 'app error');
      return reply
        .status(error.status)
        .type('application/problem+json')
        .send(
          problemBody(error.status, error.code, error.message, { detail: error.message, ...extra }),
        );
    }
    if (error instanceof ZodError) {
      return reply
        .status(422)
        .type('application/problem+json')
        .send(
          problemBody(422, 'validation_failed', 'Some fields are invalid', {
            errors: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          }),
        );
    }
    const fe = error as FastifyError;
    if (fe.statusCode && fe.statusCode >= 400 && fe.statusCode < 500) {
      return reply
        .status(fe.statusCode)
        .type('application/problem+json')
        .send(
          problemBody(
            fe.statusCode,
            fe.statusCode === 415 || fe.statusCode === 400 ? 'validation_failed' : 'not_found',
            fe.message,
          ),
        );
    }
    req.log.error({ err: error }, 'unhandled error');
    return reply
      .status(500)
      .type('application/problem+json')
      .send(problemBody(500, 'internal', 'Something went wrong'));
  });
}
