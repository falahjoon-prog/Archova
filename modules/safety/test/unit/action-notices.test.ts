import { describe, expect, it } from 'vitest';
import {
  planActionNotices,
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
});
