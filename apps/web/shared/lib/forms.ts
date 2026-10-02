import { toErrorView } from './errors';

/** The slice of a zod schema (from @archova/contracts) that form validation needs. */
export interface FormSchema<T> {
  safeParse(value: unknown):
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> };
      };
}

export type FieldErrors = Record<string, string>;

/**
 * Validates form values with the same zod schema the API uses (frontend 02 §5). `messages` replaces zod's generic
 * text with copy written for people, per field.
 */
export function parseForm<T>(
  schema: FormSchema<T>,
  values: unknown,
  messages: Record<string, string> = {},
): { ok: true; data: T } | { ok: false; fieldErrors: FieldErrors } {
  const result = schema.safeParse(values);
  if (result.success) return { ok: true, data: result.data };
  const fieldErrors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.map(String).join('.') || 'form';
    if (!(key in fieldErrors)) fieldErrors[key] = messages[key] ?? issue.message;
  }
  return { ok: false, fieldErrors };
}

/** Field errors the API returned in the problem's `errors[]`, for mapping back onto inputs. */
export function serverFieldErrors(error: unknown): FieldErrors {
  return error ? toErrorView(error).fieldErrors : {};
}

/** Drops empty strings so optional fields are omitted rather than sent as `""`. */
export function withoutEmpty<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, v]) => v !== '' && v !== undefined),
  ) as Partial<T>;
}
