// Per-item activity on an inspection (a Procore-style strip: response changes, attachments, photos, comments,
// observations) and the suggestion to raise an observation. Pure, no IO.
import type { ItemResult } from './inspection';

export type ItemEventKind = 'response' | 'comment' | 'attachment' | 'photo' | 'observation';

export interface ItemEventLite {
  kind: ItemEventKind;
  fileCount: number;
}

export interface ItemActivityCounts {
  responseChanges: number;
  attachments: number;
  photos: number;
  comments: number;
  observations: number;
}

export function countActivity(events: readonly ItemEventLite[]): ItemActivityCounts {
  const c: ItemActivityCounts = {
    responseChanges: 0,
    attachments: 0,
    photos: 0,
    comments: 0,
    observations: 0,
  };
  for (const e of events) {
    if (e.kind === 'response') c.responseChanges++;
    else if (e.kind === 'comment') c.comments++;
    else if (e.kind === 'attachment') c.attachments += e.fileCount;
    else if (e.kind === 'photo') c.photos += e.fileCount;
    else c.observations++;
  }
  return c;
}

export interface ItemSuggestion {
  code: 'failed_with_photo';
  message: string;
}

/**
 * A failed item with a photo attached is flagged as high risk and an observation is suggested. This is a rule, not a
 * reading of the photo: it never creates anything, a person confirms. Once an observation exists for the item the
 * suggestion goes away.
 */
export function itemSuggestion(
  result: ItemResult | null,
  photos: number,
  observations: number,
): ItemSuggestion | null {
  if (result !== 'fail' || photos === 0 || observations > 0) return null;
  return {
    code: 'failed_with_photo',
    message: 'Failed with a photo attached. Raise an observation so someone is assigned to fix it?',
  };
}

/** The observation text a "Create Observation" press starts from; the person edits it before saving. */
export function observationDraft(input: {
  inspectionLabel: string;
  itemPrompt: string;
  result: ItemResult | null;
  comment: string | null;
}): string {
  const head = `${input.inspectionLabel}: ${input.itemPrompt}`;
  const state = input.result === 'fail' ? ' (failed)' : '';
  return input.comment?.trim() ? `${head}${state}\n${input.comment.trim()}` : `${head}${state}`;
}
