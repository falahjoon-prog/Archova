import type { components } from '@archova/contracts/openapi';
import type { MarkupShape } from '@archova/markup';

type ApiShape = components['schemas']['MarkupShape'];

/** The API shape for one of ours: the same fields plus the shape's own id. */
export function toApiShape(shape: MarkupShape, id: string): ApiShape {
  return { id, ...shape };
}

/** Ours from the API's, or null for a shape missing the fields its kind needs. Colour and width carry over. */
export function fromApiShape(s: ApiShape): MarkupShape | null {
  const style = {
    ...(s.color ? { color: s.color } : {}),
    ...(s.strokeWidth !== undefined ? { strokeWidth: s.strokeWidth } : {}),
  };
  switch (s.kind) {
    case 'pen':
      return s.points ? { kind: 'pen', points: s.points, ...style } : null;
    case 'line':
    case 'arrow':
    case 'rect':
    case 'ellipse':
    case 'cloud':
      return s.from && s.to ? { kind: s.kind, from: s.from, to: s.to, ...style } : null;
    case 'text':
      return s.at ? { kind: 'text', at: s.at, text: s.text ?? '', ...style } : null;
    case 'pin':
      return s.at && s.entityType && s.entityId
        ? { kind: 'pin', at: s.at, entityType: s.entityType, entityId: s.entityId }
        : null;
  }
}
