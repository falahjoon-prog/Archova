import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { fakeProblem } = await import('@/test/fake-api');
const { createInductionBuilderApi } = await import('../data/api');

const P = '/v1/orgs/{orgId}/projects/{projectId}/inductions';
const I = `${P}/{inductionId}`;
const IND = 'ind_00000000000000000000000001';
const content = { sections: [], quiz: [], passMark: 80 };
const induction = (version: number) => ({ id: IND, title: 'Site induction', version });

beforeEach(() => fake.reset());

describe('Induction builder API source', () => {
  it('lists inductions and reads one', async () => {
    fake.on('GET', P, () => ({ data: [induction(1)], nextCursor: null }));
    fake.on('GET', I, () => induction(3));
    const api = createInductionBuilderApi('org_1');
    expect(await api.list('prj_1')).toHaveLength(1);
    expect(await api.get('prj_1', IND)).toMatchObject({ id: IND, version: 3 });
  });

  it('creates with an idempotency key and trims the title', async () => {
    fake.on('POST', P, () => induction(1));
    await createInductionBuilderApi('org_1').create('prj_1', {
      title: '  Site induction ',
      validityMonths: 12,
    });
    const [call] = fake.callsTo('POST', P);
    expect(call?.init.body).toEqual({ title: 'Site induction', validityMonths: 12 });
    expect(call?.init.params?.header?.['Idempotency-Key']).toBeTruthy();
  });

  it('sends the version as If-Match on draft, approval and archive writes', async () => {
    fake.on('PUT', `${I}/draft`, () => induction(5));
    fake.on('POST', `${I}/draft/approvals`, () => induction(6));
    fake.on('PATCH', I, () => induction(7));
    const api = createInductionBuilderApi('org_1');
    await api.saveDraft('prj_1', induction(4) as never, content);
    await api.approve('prj_1', induction(5) as never, 2);
    await api.update('prj_1', induction(6) as never, { status: 'archived' });
    expect(fake.callsTo('PUT', `${I}/draft`)[0]?.init).toMatchObject({
      params: { header: { 'If-Match': '"4"' } },
      body: { content },
    });
    expect(fake.callsTo('POST', `${I}/draft/approvals`)[0]?.init).toMatchObject({
      params: { header: { 'If-Match': '"5"' } },
      body: { section: 2 },
    });
    expect(fake.callsTo('PATCH', I)[0]?.init).toMatchObject({
      params: { header: { 'If-Match': '"6"' } },
      body: { status: 'archived' },
    });
  });

  it('publishes, then reads the induction back for its new version', async () => {
    fake.on('POST', `${I}/publish`, () => ({ id: 'inv_1', number: 2 }));
    fake.on('GET', I, () => induction(9));
    const out = await createInductionBuilderApi('org_1').publish('prj_1', induction(8) as never, {
      redo: 'all',
      graceDays: 7,
      changeNote: '  New gate  ',
    });
    expect(fake.callsTo('POST', `${I}/publish`)[0]?.init).toMatchObject({
      params: { header: { 'If-Match': '"8"' } },
      body: { redo: 'all', graceDays: 7, changeNote: 'New gate' },
    });
    expect(out.version).toBe(9);
  });

  it('leaves a blank change note out and surfaces a refused publish', async () => {
    fake.on('POST', `${I}/publish`, () => fakeProblem(422, 'inductions.not_publishable'));
    await expect(
      createInductionBuilderApi('org_1').publish('prj_1', induction(8) as never, {
        redo: 'none',
        graceDays: 0,
        changeNote: ' ',
      }),
    ).rejects.toMatchObject({ code: 'inductions.not_publishable' });
    expect(fake.callsTo('POST', `${I}/publish`)[0]?.init.body).toEqual({
      redo: 'none',
      graceDays: 0,
    });
  });

  it('reads the register', async () => {
    fake.on('GET', '/v1/orgs/{orgId}/projects/{projectId}/induction-register', () => ({
      inductionId: IND,
      requiredVersion: 1,
      data: [],
    }));
    expect(await createInductionBuilderApi('org_1').register('prj_1')).toMatchObject({
      requiredVersion: 1,
    });
  });

  it('lists links, creates one with an idempotency key, and revokes it', async () => {
    const LINKS = `${I}/links`;
    const LNK = 'lnk_00000000000000000000000001';
    fake.on('GET', LINKS, () => ({ data: [{ id: LNK, state: 'active' }] }));
    fake.on('POST', LINKS, () => ({ link: { id: LNK }, token: 'arl_x', url: '/i/arl_x' }));
    fake.on('POST', `${LINKS}/{linkId}/revoke`, () => ({ id: LNK, state: 'revoked' }));
    const api = createInductionBuilderApi('org_1');
    expect(await api.listLinks('prj_1', IND)).toHaveLength(1);
    const made = await api.createLink('prj_1', IND, { label: 'Gate poster', expiresInDays: 7 });
    expect(made.url).toBe('/i/arl_x');
    const [call] = fake.callsTo('POST', LINKS);
    expect(call?.init.body).toEqual({ label: 'Gate poster', expiresInDays: 7 });
    expect(call?.init.params?.header?.['Idempotency-Key']).toBeTruthy();
    expect(await api.revokeLink('prj_1', IND, LNK)).toMatchObject({ state: 'revoked' });
    expect(fake.callsTo('POST', `${LINKS}/{linkId}/revoke`)[0]?.init.params?.path).toMatchObject({
      linkId: LNK,
    });
  });

  it('checks currency, redrafts, decides, and saves the draft against the refresh', async () => {
    const AI = '/v1/orgs/{orgId}/projects/{projectId}/ai';
    const SID = 'ais_00000000000000000000000001';
    fake.on('GET', `${AI}/induction-drafts/{suggestionId}/currency`, () => ({ upToDate: true }));
    fake.on('POST', `${AI}/induction-drafts/{suggestionId}/refresh`, () => ({ id: SID }));
    fake.on('POST', `${AI}/suggestions/{suggestionId}/decision`, () => ({ id: SID }));
    fake.on('PUT', `${I}/draft`, () => induction(5));
    const api = createInductionBuilderApi('org_1');
    expect(await api.currency('prj_1', SID)).toMatchObject({ upToDate: true });
    expect(await api.refreshDraft('prj_1', SID)).toMatchObject({ id: SID });
    await api.decideSuggestion('prj_1', SID, 'accepted');
    await api.saveDraft('prj_1', induction(4) as never, content, SID);
    expect(
      fake.callsTo('POST', `${AI}/suggestions/{suggestionId}/decision`)[0]?.init,
    ).toMatchObject({
      body: { decision: 'accepted' },
    });
    expect(fake.callsTo('PUT', `${I}/draft`)[0]?.init).toMatchObject({
      body: { content, aiSuggestionId: SID },
    });
  });

  it('asks Nova to draft the induction with the trimmed site name', async () => {
    const AI = '/v1/orgs/{orgId}/projects/{projectId}/ai';
    fake.on('POST', `${AI}/induction-drafts`, () => ({ id: 'ais_00000000000000000000000002' }));
    await createInductionBuilderApi('org_1').draftInduction('prj_1', '  Harbour St ');
    expect(fake.callsTo('POST', `${AI}/induction-drafts`)[0]?.init).toMatchObject({
      body: { siteName: 'Harbour St' },
    });
  });
});
