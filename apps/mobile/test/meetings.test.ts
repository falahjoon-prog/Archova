import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@archova/api-client';
import { mobileRoutes } from '@archova/routes';
import {
  carriedText,
  closeAction,
  dueText,
  meetingSubtitle,
  myActions,
} from '../features/meetings';

vi.mock('../features/meetings/screens/MeetingsScreen', () => ({}));
vi.mock('../features/meetings/screens/MeetingMinutesScreen', () => ({}));

describe('meeting text', () => {
  it('says when an action is due or how late it is', () => {
    expect(dueText('2026-11-12', false)).toBe('Due 12 Nov');
    expect(dueText('2026-11-02', true)).toBe('Overdue, was due 2 Nov');
    expect(dueText(null, false)).toBe('No due date');
  });
  it('counts carries in plain words', () => {
    expect(carriedText(0)).toBeNull();
    expect(carriedText(1)).toBe('Carried forward once');
    expect(carriedText(3)).toBe('Carried forward 3 times');
  });
  it('summarises a meeting row', () => {
    expect(
      meetingSubtitle({
        number: 4,
        heldAt: '2026-11-03T22:00:00.000Z',
        status: 'draft',
        openActions: 2,
      }),
    ).toMatch(/^Meeting 4, \d+ Nov 2026, not issued, 2 open actions$/);
    expect(
      meetingSubtitle({
        number: 5,
        heldAt: '2026-11-10T02:00:00.000Z',
        status: 'issued',
        openActions: 0,
      }),
    ).toMatch(/^Meeting 5, \d+ Nov 2026$/);
  });
  it('has routes for the list and a meeting', () => {
    expect(mobileRoutes.meetings('prj_1')).toBe('/project/prj_1/meetings');
    expect(mobileRoutes.meeting('prj_1', 'mtg_2')).toBe('/project/prj_1/meetings/mtg_2');
  });
});

describe('meeting calls', () => {
  const target = { orgId: 'org_1', projectId: 'prj_1' };
  const ok = (data: unknown) => ({ data, response: { ok: true } });

  it('asks for only my actions', async () => {
    const GET = vi.fn().mockResolvedValue(ok({ data: [{ id: 'a' }] }));
    expect(await myActions({ GET } as unknown as ApiClient, target)).toEqual([{ id: 'a' }]);
    expect(GET).toHaveBeenCalledWith(
      '/v1/orgs/{orgId}/projects/{projectId}/meeting-actions',
      expect.objectContaining({ params: expect.objectContaining({ query: { scope: 'mine' } }) }),
    );
  });

  it('closes an action against the version that was read', async () => {
    const PATCH = vi.fn().mockResolvedValue(ok({ meeting: {} }));
    await closeAction({ PATCH } as unknown as ApiClient, target, { id: 'mti_1', version: 3 });
    const [, init] = PATCH.mock.calls[0]!;
    expect(init.params.header).toEqual({ 'If-Match': '"3"' });
    expect(init.params.path.itemId).toBe('mti_1');
    expect(init.body).toEqual({ status: 'closed' });
  });
});
