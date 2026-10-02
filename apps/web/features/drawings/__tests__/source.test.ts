import { beforeEach, describe, expect, it } from 'vitest';
import { compareRevs, drawingsSource, publishBlockers, resetDrawingsPreview } from '../data/source';

const P = 'prj_test';
const me = { id: 'usr_me', name: 'Test User', companyId: 'cmp_builder' };

beforeEach(() => resetDrawingsPreview());

describe('drawings preview source', () => {
  it('lists current revisions only, filtered', async () => {
    const all = await drawingsSource.listSheets(P);
    expect(all.find((s) => s.sheetNumber === 'A-101')?.currentRev).toBe('C');
    const structural = await drawingsSource.listSheets(P, { discipline: 'S' });
    expect(structural.map((s) => s.sheetNumber)).toEqual(['S-201']);
    const forConstruction = await drawingsSource.listSheets(P, { issuedFor: 'for_construction' });
    expect(forConstruction.every((s) => s.currentIssuedFor === 'for_construction')).toBe(true);
  });

  it('orders revision labels, letters before numbers', () => {
    expect(compareRevs('B', 'C')).toBeLessThan(0);
    expect(compareRevs('C', '0')).toBeLessThan(0);
    expect(compareRevs('2', '10')).toBeLessThan(0);
    expect(compareRevs('P1', 'A')).toBeLessThan(0);
  });

  it('blocks publishing until low-confidence fields are touched, then supersedes in one step', async () => {
    const set = await drawingsSource.createSet(P, {
      name: 'IFC 4',
      issuedFor: 'for_construction',
      fileNames: ['A-101_RevD.pdf', 'scan-0003.pdf'],
    });
    const [known, unknown] = set.sheets;
    expect(known?.conflict).toBe('none');
    expect(unknown?.conflict).toBe('new_sheet');
    expect(publishBlockers(set).length).toBeGreaterThan(0);
    await expect(drawingsSource.publishSet(P, set.id)).rejects.toMatchObject({ status: 422 });

    await drawingsSource.updateReviewSheet(P, set.id, unknown!.id, {
      sheetNumber: 'A-110',
      title: 'Roof plan',
      rev: 'A',
    });
    const ready = await drawingsSource.getSet(P, set.id);
    expect(publishBlockers(ready)).toEqual([]);
    await drawingsSource.publishSet(P, set.id);

    const { revisions } = await drawingsSource.getSheet(P, 'sht_a101');
    const current = revisions.filter((r) => r.status === 'current');
    expect(current.map((r) => r.rev)).toEqual(['D']);
    const c = revisions.find((r) => r.rev === 'C')!;
    expect(c.status).toBe('superseded');
    expect(c.supersededByRev).toBe('D');
    expect((await drawingsSource.listSheets(P)).some((s) => s.sheetNumber === 'A-110')).toBe(true);
  });

  it('needs a reason for an older revision and rejects a duplicate', async () => {
    const set = await drawingsSource.createSet(P, {
      name: 'Re-issue',
      issuedFor: 'for_construction',
      fileNames: ['A-101_RevB.pdf', 'A-102_RevA.pdf'],
    });
    expect(set.sheets[0]?.conflict).toBe('same_revision_exists');
    expect(set.sheets[1]?.conflict).toBe('older_revision');
    const blockers = publishBlockers(set);
    expect(blockers.some((b) => b.includes('already in the register'))).toBe(true);
    expect(blockers.some((b) => b.includes('Give a reason'))).toBe(true);
  });

  it('keeps private markups private and stops deletes once published (X12, DOC-AC7)', async () => {
    const mine = await drawingsSource.createMarkup(
      P,
      'rev_a101_c',
      {
        shape: { kind: 'rect', from: { x: 0.1, y: 0.1 }, to: { x: 0.2, y: 0.2 } },
        visibility: 'private',
      },
      me,
    );
    const other = { id: 'usr_other', name: 'Other', companyId: 'cmp_builder' };
    expect(
      (await drawingsSource.listMarkups(P, 'rev_a101_c', other)).some((m) => m.id === mine.id),
    ).toBe(false);
    await drawingsSource.setMarkupVisibility(P, mine.id, 'company', me);
    expect(
      (await drawingsSource.listMarkups(P, 'rev_a101_c', other)).some((m) => m.id === mine.id),
    ).toBe(true);
    const subbie = { id: 'usr_sub', name: 'Sub', companyId: 'cmp_elec' };
    expect(
      (await drawingsSource.listMarkups(P, 'rev_a101_c', subbie)).some((m) => m.id === mine.id),
    ).toBe(false);
    await drawingsSource.setMarkupVisibility(P, mine.id, 'project', me);
    await expect(drawingsSource.deleteMarkup(P, mine.id, me)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('records who confirmed the scale', async () => {
    const g = await drawingsSource.confirmScale(P, 'rev_a102_b', '1:50', me);
    expect(g).toMatchObject({
      scaleConfirmed: '1:50',
      scaleConfirmedBy: 'Test User',
      scaleConflict: null,
    });
  });
});
