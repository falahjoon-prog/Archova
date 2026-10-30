import { beforeEach, describe, expect, it } from 'vitest';
import { resetRfisPreview, rfisSource } from '../data/source';
import type { RfiInput } from '../lib/types';

const P = 'prj_src';
const pm = { id: 'usr_pm', name: 'Dana Okafor', companyId: 'cmp_builder' };
const eng = { id: 'usr_eng', name: 'Jo Smith', companyId: 'cmp_struct' };

const input = (over: Partial<RfiInput> = {}): RfiInput => ({
  subject: 'Footing depth at grid A1',
  question: 'What is the founding depth?',
  assigneeId: 'usr_eng',
  dueDate: '2026-10-09',
  distributionCompanyIds: [],
  costImpact: 'tbc',
  scheduleImpactDays: null,
  drawing: null,
  specSection: null,
  location: null,
  isPrivate: false,
  ...over,
});

beforeEach(() => resetRfisPreview());

describe('rfisSource', () => {
  it('issues numbers on submit and never reuses a voided one (RFI-AC1)', async () => {
    const draft = await rfisSource.create(P, input(), pm, false);
    expect(draft.number).toBeNull();
    const a = await rfisSource.submit(P, draft.id, pm);
    expect(a.number).toBe(5);
    await rfisSource.void(P, a.id, 'Raised twice', pm);
    const b = await rfisSource.create(P, input(), pm, true);
    expect(b.number).toBe(6);
  });

  it('refuses to submit without the required fields', async () => {
    const draft = await rfisSource.create(P, input({ assigneeId: null }), pm, false);
    await expect(rfisSource.submit(P, draft.id, pm)).rejects.toMatchObject({ status: 422 });
  });

  it('moves the ball on submit, answer and reopen (RFI-AC4)', async () => {
    const rfi = await rfisSource.create(P, input(), pm, true);
    expect(rfi.ballInCourtCompanyId).toBe('cmp_struct');
    const answered = await rfisSource.respond(
      P,
      rfi.id,
      { body: 'Founding at 1.2 m.', aiSuggestionId: null },
      eng,
    );
    expect(answered.status).toBe('answered');
    expect(answered.ballInCourtId).toBe('usr_pm');
    const closed = await rfisSource.close(P, rfi.id, answered.responses[0]!.id, pm);
    expect(closed.ballInCourtId).toBeNull();
    const reopened = await rfisSource.reopen(P, rfi.id, 'Geotech report changed', pm);
    expect(reopened.ballInCourtId).toBe('usr_eng');
    expect(reopened.officialResponseId).toBeNull();
    expect(reopened.activity.at(-1)).toMatchObject({
      action: 'reopened the RFI',
      detail: 'Geotech report changed',
    });
  });

  it('closes only with one of its own responses as official (RFI-AC7)', async () => {
    await expect(rfisSource.close(P, 'rfi_002', 'rsp_nope', pm)).rejects.toMatchObject({
      status: 422,
    });
    const closed = await rfisSource.close(P, 'rfi_002', 'rsp_2', pm);
    expect(closed.responses.filter((r) => r.isOfficial)).toHaveLength(1);
  });

  it('logs due date changes and reassignments after submit (RFI-AC10)', async () => {
    const rfi = await rfisSource.update(
      P,
      'rfi_003',
      { ...input(), dueDate: '2026-10-06', assigneeId: 'usr_eng' },
      pm,
    );
    const actions = rfi.activity.map((a) => a.action);
    expect(actions).toContain('changed the due date');
    expect(actions).toContain('reassigned the RFI');
    expect(rfi.ballInCourtCompanyId).toBe('cmp_struct');
  });

  it('filters the register by ball in court, overdue and impact', async () => {
    expect(
      (await rfisSource.list(P, { ballInCourtCompanyId: 'cmp_arch' })).map((r) => r.id),
    ).toEqual(['rfi_003']);
    expect((await rfisSource.list(P, { overdueBefore: '2026-10-02' })).map((r) => r.id)).toEqual([
      'rfi_003',
    ]);
    expect((await rfisSource.list(P, { impact: 'yes' })).map((r) => r.id)).toEqual(['rfi_002']);
  });

  it('says what a Nova answer draft rests on: documents, the direction alone, or nothing', async () => {
    const bare = await rfisSource.create(P, input(), pm, true);
    expect(await rfisSource.novaDraftResponse(P, bare.id)).toMatchObject({
      basis: 'none',
      references: [],
      needsDecision: ['Whether the work changes scope or time.'],
    });
    expect(await rfisSource.novaDraftResponse(P, bare.id, 'use 600 deep footings')).toMatchObject({
      basis: 'direction',
      text: expect.stringMatching(/^Use 600 deep footings\./),
    });
    const cited = await rfisSource.create(P, input({ specSection: '0331 Concrete' }), pm, true);
    expect(await rfisSource.novaDraftResponse(P, cited.id)).toMatchObject({
      basis: 'documents',
      references: [expect.objectContaining({ label: 'Spec 0331 Concrete' })],
    });
  });
});
