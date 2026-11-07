import { describe, expect, it } from 'vitest';
import {
  planActionNotices,
  planOverdueNotices,
  type ActionNoticeCandidate,
} from '../../src/application/action-notices';

const base: ActionNoticeCandidate = {
  actionId: 'a1',
  incidentId: 'i1',
  projectId: 'p1',
  incidentNumber: 7,
  actionNumber: 1,
  title: 'Fence the trench',
  dueDate: '2026-11-12',
  recipients: ['u1', 'u2'],
};

describe('planActionNotices', () => {
  it('tells each recipient once, keyed by action and person, with no health detail', () => {
    const plan = planActionNotices([base]);
    expect(plan.map((p) => p.userId)).toEqual(['u1', 'u2']);
    expect(plan[0]).toMatchObject({
      kind: 'safety.incident_action_assigned',
      title: 'INC-0007: corrective action assigned to you',
      body: 'Fence the trench. Due 2026-11-12.',
      dedupeKey: 'incident_action:a1:assigned',
      incidentId: 'i1',
    });
  });

  it('leaves the due date out when there is none', () => {
    expect(planActionNotices([{ ...base, dueDate: null, recipients: ['u1'] }])[0]?.body).toBe(
      'Fence the trench.',
    );
  });

  it('words a handed-on action as reassigned, under the same per-person key', () => {
    const [n] = planActionNotices([{ ...base, recipients: ['u3'], reassigned: true }]);
    expect(n).toMatchObject({
      kind: 'safety.incident_action_reassigned',
      title: 'INC-0007: corrective action reassigned to you',
      dedupeKey: 'incident_action:a1:assigned',
      userId: 'u3',
    });
  });
});

describe('planOverdueNotices', () => {
  it('keys each reminder by action and due date, so a new due date re-arms it', () => {
    const [a] = planOverdueNotices([{ ...base, recipients: ['u1'] }]);
    const [b] = planOverdueNotices([{ ...base, recipients: ['u1'], dueDate: '2026-11-20' }]);
    expect(a).toMatchObject({
      kind: 'safety.incident_action_overdue',
      title: 'INC-0007: corrective action overdue',
      body: 'Fence the trench. It was due 2026-11-12.',
    });
    expect(a?.dedupeKey).toBe('incident_action:a1:overdue:2026-11-12');
    expect(b?.dedupeKey).not.toBe(a?.dedupeKey);
  });
});
