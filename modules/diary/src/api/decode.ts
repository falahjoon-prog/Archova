import { decodeId } from '@archova/domain';
import { AppError } from '@archova/kernel';
import { ID_FIELDS } from '../domain/diary';

/** Decodes the id-bearing fields of a request body to UUIDs; everything else passes through. */
export function decodeIds(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    const kind = ID_FIELDS[k as keyof typeof ID_FIELDS];
    if (!kind || v === null || v === undefined) {
      out[k] = v;
      continue;
    }
    const one = (x: string, path: string) => {
      const id = decodeId(kind, x);
      if (!id)
        throw new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
      return id;
    };
    out[k] = Array.isArray(v) ? v.map((x: string, i) => one(x, `${k}/${i}`)) : one(v as string, k);
  }
  return out;
}
