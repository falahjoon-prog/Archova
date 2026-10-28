// A finger signature as SVG path data (IND-AC3). The server keeps it with the typed name as the record.

export interface SignaturePoint {
  x: number;
  y: number;
}

const round = (n: number) => Math.round(n * 10) / 10;

/** One `M … L …` run per stroke. A single touch becomes a short dot-sized line so it still shows. */
export function signaturePath(strokes: readonly (readonly SignaturePoint[])[]): string {
  return strokes
    .filter((s) => s.length > 0)
    .map((s) => {
      const first = s[0]!;
      const rest = s.length === 1 ? [{ x: first.x + 0.1, y: first.y }] : s.slice(1);
      return [
        `M${round(first.x)} ${round(first.y)}`,
        ...rest.map((p) => `L${round(p.x)} ${round(p.y)}`),
      ].join(' ');
    })
    .join(' ');
}

/** Long strokes are thinned so a full signature stays well inside the 200,000 character limit. */
export function thinStroke(points: readonly SignaturePoint[], minDistance = 2): SignaturePoint[] {
  const out: SignaturePoint[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minDistance) out.push(p);
  }
  const end = points[points.length - 1];
  if (end && out[out.length - 1] !== end) out.push(end);
  return out;
}
