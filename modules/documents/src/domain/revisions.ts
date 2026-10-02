// Revision ordering for AU drawing sets (product/02 "Australian specifics"): letters for preliminary
// issues (A, B, … Z, AA), numbers once issued for construction (0, 1, 2), or prefixed P1/C1 schemes.
// Any construction revision is later than any preliminary one, so "C" < "0" and "P3" < "C1".

export interface RevisionKey {
  /** 0 = preliminary, 1 = construction, 2 = unrecognised (compared as text, after the known schemes). */
  stage: 0 | 1 | 2;
  /** 0 = letters, 1 = digits, 2 = P/C prefixed: only values of the same scheme compare numerically. */
  scheme: 0 | 1 | 2;
  value: number;
  raw: string;
}

function lettersValue(s: string): number {
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function revisionKey(rev: string): RevisionKey {
  const raw = rev.trim().toUpperCase();
  if (/^[A-Z]{1,3}$/.test(raw)) return { stage: 0, scheme: 0, value: lettersValue(raw), raw };
  if (/^\d{1,6}$/.test(raw)) return { stage: 1, scheme: 1, value: Number(raw), raw };
  const prefixed = /^([PC])(\d{1,6})$/.exec(raw);
  if (prefixed)
    return {
      stage: prefixed[1] === 'P' ? 0 : 1,
      scheme: 2,
      value: Number(prefixed[2]),
      raw,
    };
  return { stage: 2, scheme: 2, value: 0, raw };
}

/** Negative when `a` is earlier than `b`, positive when later, 0 when the same revision. */
export function compareRevisions(a: string, b: string): number {
  const ka = revisionKey(a);
  const kb = revisionKey(b);
  if (ka.raw === kb.raw) return 0;
  if (ka.stage !== kb.stage) return ka.stage - kb.stage;
  if (ka.stage !== 2 && ka.scheme === kb.scheme) return ka.value - kb.value;
  return ka.raw < kb.raw ? -1 : 1;
}
