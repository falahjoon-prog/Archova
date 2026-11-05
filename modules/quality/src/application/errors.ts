/** Postgres unique violation, unwrapped from drizzle's error wrapper. */
export function uniqueViolation(e: unknown): string | null {
  const err = e as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  };
  if (err.code === '23505') return err.constraint ?? '';
  if (err.cause?.code === '23505') return err.cause.constraint ?? '';
  return null;
}
