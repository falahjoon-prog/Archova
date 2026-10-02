import type { MarkupVisibility } from '@archova/markup';

/** A shape on a markup layer, normalised 0..1 sheet coordinates (`@archova/markup`). Each shape has its own id
 * so edits from two devices merge by shape. */
export interface StoredShape {
  id: string;
  kind: string;
  [field: string]: unknown;
}

type Pt = { x: number; y: number };
const isPoint = (p: unknown): p is Pt =>
  typeof p === 'object' &&
  p !== null &&
  typeof (p as Pt).x === 'number' &&
  typeof (p as Pt).y === 'number' &&
  (p as Pt).x >= 0 &&
  (p as Pt).x <= 1 &&
  (p as Pt).y >= 0 &&
  (p as Pt).y <= 1;

/** Returns the index and reason of the first invalid shape, or null when every shape is well formed. */
export function invalidShape(
  shapes: readonly StoredShape[],
): { index: number; reason: string } | null {
  const ids = new Set<string>();
  for (const [index, s] of shapes.entries()) {
    if (ids.has(s.id)) return { index, reason: 'Shape ids must be unique' };
    ids.add(s.id);
    switch (s.kind) {
      case 'pen':
        if (!Array.isArray(s.points) || s.points.length < 2 || !s.points.every(isPoint))
          return { index, reason: 'A pen stroke needs at least two points within the sheet' };
        break;
      case 'line':
      case 'arrow':
      case 'rect':
      case 'ellipse':
      case 'cloud':
        if (!isPoint(s.from) || !isPoint(s.to))
          return { index, reason: `A ${s.kind} needs from and to points within the sheet` };
        break;
      case 'text':
        if (!isPoint(s.at) || typeof s.text !== 'string' || s.text.length === 0)
          return { index, reason: 'Text needs a position and some text' };
        break;
      case 'pin':
        if (!isPoint(s.at)) return { index, reason: 'A pin needs a position within the sheet' };
        break;
      default:
        return { index, reason: `Unknown shape kind ${s.kind}` };
    }
  }
  return null;
}

/** Who sees a markup (X12): the author always; their company for `company`; everyone for `project`. */
export function canSeeMarkup(
  m: { ownerId: string; ownerCompanyId: string | null; visibility: MarkupVisibility },
  viewer: { userId: string; companyId: string | null },
): boolean {
  if (m.ownerId === viewer.userId) return true;
  if (m.visibility === 'project') return true;
  return (
    m.visibility === 'company' && viewer.companyId !== null && m.ownerCompanyId === viewer.companyId
  );
}
