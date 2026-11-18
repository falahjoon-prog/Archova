import { describe, expect, it, vi } from 'vitest';
import { createDefect, listDefects, transitionDefect } from '../features/defects';
import { migrate, SqliteSyncStore } from '../lib/db';
import { nodeSqlDriver } from './support/node-sql';

// Screens need React Native; these tests cover the commands.
vi.mock('../features/defects/screens/DefectListScreen', () => ({}));
vi.mock('../features/defects/screens/NewDefectScreen', () => ({}));
vi.mock('../features/defects/screens/DefectDetailScreen', () => ({}));

const AT = '2026-10-02T23:30:00.000Z';

async function store() {
  const db = await nodeSqlDriver().open('t.db');
  await migrate(db);
  return new SqliteSyncStore(db, { moduleOf: (t) => (t === 'defect' ? 'defects' : 'photos') });
}

const base = {
  projectId: 'prj_a',
  title: '  Chipped tile, unit 302 ensuite ',
  locationId: 'loc_302_ensuite',
  trade: 'Tiling',
  clientAt: AT,
};

describe('defect commands', () => {
  it('raises an assigned defect as open, offline, with a local label until numbered', async () => {
    const s = await store();
    const result = await createDefect(s, {
      ...base,
      defectId: 'd1',
      mutationId: 'm1',
      issueMutationId: 'm1_issue',
      assigneeCompanyId: 'co_tiler',
    });
    expect(result).toMatchObject({ ok: true, value: { defect: { status: 'open', number: null } } });
    expect(await s.listOutbox()).toMatchObject([
      {
        command: 'defects.create',
        entityId: 'd1',
        clientAt: AT,
        payload: {
          title: 'Chipped tile, unit 302 ensuite',
          status: 'open',
          locationId: 'loc_302_ensuite',
        },
      },
      // The server starts every defect as a draft, so an assigned one is issued right after it is created.
      {
        mutationId: 'm1_issue',
        command: 'defects.issue',
        entityId: 'd1',
        baseVersion: 1,
        dependsOn: ['m1'],
      },
    ]);
    expect(await listDefects(s, 'prj_a')).toMatchObject([{ id: 'd1', pending: true }]);
    expect(await listDefects(s, 'prj_a', { assigneeCompanyId: 'co_other' })).toEqual([]);
  });

  it('keeps unassigned defects as drafts and refuses ones with no title or location', async () => {
    const s = await store();
    expect(await createDefect(s, { ...base, defectId: 'd1', mutationId: 'm1' })).toMatchObject({
      ok: true,
      value: { defect: { status: 'draft' } },
    });
    expect(
      await createDefect(s, { ...base, title: ' ', defectId: 'd2', mutationId: 'm2' }),
    ).toEqual({ ok: false, code: 'defect.title_required' });
    expect(
      await createDefect(s, { ...base, locationId: null, defectId: 'd3', mutationId: 'm3' }),
    ).toEqual({ ok: false, code: 'defect.location_required' });
    expect(
      await createDefect(s, {
        ...base,
        locationId: null,
        sheetId: 'sh_1',
        pinX: 0.4,
        pinY: 0.6,
        defectId: 'd4',
        mutationId: 'm4',
      }),
    ).toMatchObject({ ok: true });
  });

  it('leaves an unassigned defect as a draft with no issue command', async () => {
    const s = await store();
    await createDefect(s, { ...base, defectId: 'd9', mutationId: 'm9' });
    expect((await s.listOutbox()).map((e) => e.command)).toEqual(['defects.create']);
  });

  it('marks ready for inspection with its after photo, sent after the photo', async () => {
    const s = await store();
    const created = await createDefect(s, {
      ...base,
      defectId: 'd1',
      mutationId: 'm1',
      assigneeCompanyId: 'co_tiler',
    });
    if (!created.ok) throw new Error('setup');
    const defect = created.value.defect;

    const noPhoto = await transitionDefect(s, {
      defect,
      version: null,
      action: 'markReadyForReview',
      actor: 'assignee',
      mutationId: 'm2',
      clientAt: AT,
    });
    expect(noPhoto).toEqual({ ok: false, code: 'defect.photo_required' });

    const ready = await transitionDefect(s, {
      defect,
      version: null,
      action: 'markReadyForReview',
      actor: 'assignee',
      mutationId: 'm3',
      photos: [{ photoId: 'pho_1', mutationId: 'm_pho_1' }],
      clientAt: AT,
    });
    expect(ready).toMatchObject({ ok: true, value: { status: 'ready_for_review' } });
    expect((await s.listOutbox()).at(-1)).toMatchObject({
      command: 'defects.markReadyForReview',
      dependsOn: ['m_pho_1'],
      payload: { photoIds: ['pho_1'], note: null },
    });
  });

  it('needs a reason to reject, and only the builder may', async () => {
    const s = await store();
    const defect = {
      id: 'd1',
      projectId: 'prj_a',
      number: 12,
      title: 't',
      description: '',
      status: 'ready_for_review' as const,
      priority: 'medium' as const,
      stage: 'pre_pc' as const,
      trade: null,
      assigneeCompanyId: 'co_tiler',
      dueDate: null,
      locationId: 'l',
      sheetId: null,
      drawingRevisionId: null,
      pinX: null,
      pinY: null,
      raisedAt: AT,
      statusChangedAt: AT,
    };
    const input = { defect, version: 4, action: 'reject' as const, mutationId: 'm1', clientAt: AT };
    expect(await transitionDefect(s, { ...input, actor: 'assignee', reason: 'x' })).toEqual({
      ok: false,
      code: 'defect.not_allowed',
    });
    expect(await transitionDefect(s, { ...input, actor: 'builder' })).toEqual({
      ok: false,
      code: 'defect.reason_required',
    });
    expect(
      await transitionDefect(s, { ...input, actor: 'builder', reason: 'Grout still cracked' }),
    ).toMatchObject({ ok: true, value: { status: 'open' } });
    expect(await s.listOutbox()).toMatchObject([
      { command: 'defects.reject', baseVersion: 4, payload: { note: 'Grout still cracked' } },
    ]);
  });
});
