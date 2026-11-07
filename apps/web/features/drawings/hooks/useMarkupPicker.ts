'use client';

import { useMarkups } from './useDrawings';

export interface MarkupOption {
  /** The record's id, without the shape suffix the viewer adds. */
  markupId: string;
  /** "Cloud", or the words of a text note. */
  label: string;
}

const KIND_LABELS = {
  pen: 'Freehand',
  line: 'Line',
  arrow: 'Arrow',
  rect: 'Box',
  ellipse: 'Ellipse',
  cloud: 'Cloud',
  text: 'Text',
  pin: 'Pin',
} as const;

/** The markups the person can see on a revision, as options, so an RFI can be drafted from one. */
export function useMarkupPicker(projectId: string, revisionId: string | undefined) {
  const markups = useMarkups(projectId, revisionId);
  const seen = new Set<string>();
  const options: MarkupOption[] = [];
  for (const m of markups.data ?? []) {
    const markupId = m.id.split('~')[0]!;
    // Pins belong to RFIs and defects already; a markup with several shapes is listed once.
    if (m.shape.kind === 'pin' || seen.has(markupId)) continue;
    seen.add(markupId);
    const kind = KIND_LABELS[m.shape.kind];
    const text = m.shape.kind === 'text' ? m.shape.text.trim() : '';
    options.push({
      markupId,
      label: text ? `${kind}: ${text.length > 40 ? `${text.slice(0, 40)}…` : text}` : kind,
    });
  }
  return { options, isPending: Boolean(revisionId) && markups.isPending };
}
