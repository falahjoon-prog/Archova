import { beforeEach, describe, expect, it } from 'vitest';
import { defectsSource, resetDefectsPreview } from '../data/source';
import { defectInputErrors } from '../lib/lifecycle';
import { defectsToCsv } from '../lib/csv';
import { formatDefectNumber } from '../lib/types';

const P = 'prj_src';
const sm = { id: 'usr_sm', name: 'Luca Romano', companyId: 'cmp_builder' };
const tiler = { id: 'usr_tile', name: 'Tom Nguyen', companyId: 'cmp_tile' };

beforeEach(() => resetDefectsPreview());

describe('defects', () => {
  it('needs a title, a company and a location or drawing (DEF-AC3, DEF-AC4)', () => {
    const errors = defectInputErrors({
      title: '',
      description: '',
      priority: 'medium',
      trade: '',
      stage: 'pre_pc',
      locationId: null,
      drawing: null,
      assigneeCompanyId: null,
      assigneeUserId: null,
      dueDate: null,
      photoNames: [],
    });
    expect(Object.keys(errors)).toEqual(['title', 'assigneeCompanyId', 'location']);
    expect(formatDefectNumber(12)).toBe('DEF-0012');
    expect(formatDefectNumber(null)).toBe('D-local');
  });

  it('needs an after photo to mark ready, and a reason to reject (DEF-AC5, DEF-AC6)', async () => {
    await expect(
      defectsSource.markReady(P, 'dft_0002', { note: '', photoNames: [] }, tiler),
    ).rejects.toMatchObject({ status: 422 });
    const ready = await defectsSource.markReady(
      P,
      'dft_0002',
      { note: 'Replaced', photoNames: ['after.jpg'] },
      tiler,
    );
    expect(ready.status).toBe('ready_for_review');
    expect(ready.photos.at(-1)).toMatchObject({ name: 'after.jpg', kind: 'after' });
    await expect(defectsSource.withReason(P, 'dft_0002', 'reject', ' ', sm)).rejects.toMatchObject({
      status: 422,
    });
    const rejected = await defectsSource.withReason(
      P,
      'dft_0002',
      'reject',
      'Grout colour does not match',
      sm,
    );
    expect(rejected.status).toBe('open');
    expect(rejected.events.at(-1)).toMatchObject({
      fromStatus: 'ready_for_review',
      toStatus: 'open',
      note: 'Grout colour does not match',
    });
  });

  it('reopens a disputed defect with the new company on reassign', async () => {
    const d = await defectsSource.reassign(
      P,
      'dft_0005',
      { companyId: 'cmp_dry', userId: null, dueDate: '2026-10-09' },
      sm,
    );
    expect(d).toMatchObject({
      status: 'open',
      assigneeCompanyId: 'cmp_dry',
      dueDate: '2026-10-09',
    });
  });

  it('filters by level, stage and overdue', async () => {
    expect((await defectsSource.list(P, { level: 'Ground' })).map((d) => d.id)).toEqual([
      'dft_0001',
      'dft_0002',
      'dft_0004',
    ]);
    expect((await defectsSource.list(P, { stage: 'pc' })).map((d) => d.id)).toEqual(['dft_0006']);
    expect((await defectsSource.list(P, { overdueOn: '2026-10-02' })).map((d) => d.id)).toEqual([
      'dft_0003',
    ]);
  });

  it('suggests trade and company from the description and finds duplicates at a location', async () => {
    expect(await defectsSource.novaSuggest('Cracked tile near the lift')).toMatchObject({
      trade: 'Tiling',
      companyId: 'cmp_tile',
    });
    expect(await defectsSource.novaSuggest('Something odd')).toBeNull();
    const dups = await defectsSource.novaDuplicates(P, {
      title: 'Chipped tile',
      locationId: 'loc_ground_lobby',
      sheetId: null,
    });
    expect(dups.map((d) => d.id)).toEqual(['dft_0002']);
  });

  it('exports CSV sorted by location for a walk (DEF-AC10)', async () => {
    const csv = defectsToCsv(await defectsSource.list(P, {}));
    const firstCol = csv
      .split('\n')
      .slice(1)
      .map((l) => l.split(',')[0]);
    expect(firstCol[0]).toBe('DEF-0004');
    expect(csv.split('\n')[0]).toBe('Number,Title,Location,Drawing,Company,Trade,Status,Stage,Due');
  });
});
