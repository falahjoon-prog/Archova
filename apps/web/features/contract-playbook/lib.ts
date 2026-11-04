import type { PlaybookTopic } from './data/api';

/** A topic as the admin edits it. `key` is null until the topic is saved the first time; saved keys never change. */
export interface DraftTopic {
  uid: string;
  key: string | null;
  topic: string;
  position: string;
  threshold: string;
  severity: PlaybookTopic['severity'];
  fallback: null | {
    title: string;
    wording: string;
    approvedBy: string;
    approvedOn: string;
    reviewBy: string;
  };
}

let n = 0;
export const newUid = () => `d${++n}`;

export const emptyTopic = (): DraftTopic => ({
  uid: newUid(),
  key: null,
  topic: '',
  position: '',
  threshold: '',
  severity: 'medium',
  fallback: null,
});

export const toDraft = (t: PlaybookTopic): DraftTopic => ({
  uid: newUid(),
  key: t.key,
  topic: t.topic,
  position: t.position,
  threshold: t.threshold ?? '',
  severity: t.severity,
  fallback: t.fallback ? { ...t.fallback, reviewBy: t.fallback.reviewBy ?? '' } : null,
});

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 36) || 'topic';

/** Keys for the topics saved for the first time: from the topic name, made unique within the playbook. */
export function toTopics(drafts: readonly DraftTopic[]): PlaybookTopic[] {
  const used = new Set(drafts.map((d) => d.key).filter((k): k is string => k !== null));
  return drafts.map((d) => {
    let key = d.key;
    if (key === null) {
      const base = slug(d.topic);
      key = base;
      for (let i = 2; used.has(key); i++) key = `${base}_${i}`;
      used.add(key);
    }
    return {
      key,
      topic: d.topic.trim(),
      position: d.position.trim(),
      threshold: d.threshold.trim() || null,
      severity: d.severity,
      fallback: d.fallback
        ? {
            title: d.fallback.title.trim(),
            wording: d.fallback.wording.trim(),
            approvedBy: d.fallback.approvedBy.trim(),
            approvedOn: d.fallback.approvedOn,
            reviewBy: d.fallback.reviewBy || null,
          }
        : null,
    };
  });
}

/** First problem the API would refuse, in words for the admin; null when the draft can be saved. */
export function draftProblem(d: DraftTopic): string | null {
  if (!d.topic.trim()) return 'Give the topic a name.';
  if (!d.position.trim()) return 'Say what position you want.';
  const f = d.fallback;
  if (f) {
    if (!f.title.trim() || !f.wording.trim()) return 'Add a title and the approved wording.';
    if (!f.approvedBy.trim() || !f.approvedOn) return 'Say who approved the wording and when.';
    if (f.reviewBy && f.reviewBy < f.approvedOn)
      return 'The review date is before the approval date.';
  }
  return null;
}
