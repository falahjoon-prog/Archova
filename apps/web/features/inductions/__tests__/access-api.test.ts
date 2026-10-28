import { beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { fakeProblem } = await import('@/test/fake-api');
const { createInductionAccessApi, strokesToPath, toE164 } = await import('../worker/data/api');

const A = '/v1/induction-access';
const access = (over: Record<string, unknown> = {}) => ({
  orgName: 'Harbour Builders',
  projectName: 'Harbour St Tower',
  siteName: null,
  inductionTitle: 'Site induction',
  versionNumber: 2,
  publishedAt: '2026-10-01T00:00:00Z',
  sectionCount: 2,
  languages: [],
  companies: [{ id: 'cmp_1', name: 'Brightwire Electrical' }],
  verified: false,
  verifiedTo: null,
  worker: null,
  completionId: null,
  completionStatus: 'not_started',
  expiresAt: '2026-10-02T00:00:00Z',
  ...over,
});
const completion = (over: Record<string, unknown> = {}) => ({
  id: 'inc_1',
  status: 'in_progress',
  completedAt: null,
  versionNumber: 2,
  sectionsViewed: [0],
  quiz: { attempts: 1, failedAttempts: 1, passed: false, lastScore: 40 },
  credentials: [],
  content: {
    sections: [
      { key: 'ppe', title: 'PPE', blocks: [{ type: 'text', body: '- Hard hat' }] },
      {
        key: 'site_rules',
        title: 'Rules',
        blocks: [
          { type: 'video', fileId: 'fil_1', title: null },
          { type: 'swms', documentId: 'doc_1', title: 'SWMS 03' },
        ],
      },
    ],
    quiz: [
      { id: 'q1', section: 'ppe', question: 'What do you wear?', options: ['Hat', 'Nothing'] },
      { id: 'q2', section: 'ppe', question: 'Where is first aid?', options: ['Office', 'Van'] },
    ],
    passMark: 80,
    declarationText: 'I am fit for work.\nI will follow the rules.',
    swmsNotice: 'Awareness only.',
  },
  ...over,
});

beforeEach(() => fake.reset());

describe('Induction access API source', () => {
  it('exchanges the token once, sends nothing but the token, and holds no content until verified', async () => {
    fake.on('POST', A, () => access());
    const opened = await createInductionAccessApi().open('arl_x', null);
    expect(fake.callsTo('POST', A)[0]?.init.body).toEqual({ token: 'arl_x' });
    expect(fake.callsTo('GET', `${A}/completion`)).toHaveLength(0);
    expect(opened).toMatchObject({
      state: 'open',
      site: { builderName: 'Harbour Builders', siteName: 'Harbour St Tower' },
      induction: { sectionCount: 2, sections: [], name: 'Site induction' },
      companies: [{ id: 'cmp_1', name: 'Brightwire Electrical' }],
      progress: { verified: false },
    });
  });

  it('resumes a verified worker from the cookie with sections, progress and statements', async () => {
    fake.on('GET', A, () =>
      access({
        verified: true,
        verifiedTo: '+61 4•• ••• 678',
        worker: { fullName: 'Sam Worker', companyName: 'Brightwire', returning: true },
      }),
    );
    fake.on('GET', `${A}/completion`, () => completion());
    const opened = await createInductionAccessApi().open('continue', null);
    expect(opened).toMatchObject({
      induction: { declaration: ['I am fit for work.', 'I will follow the rules.'] },
      progress: {
        verified: true,
        returning: true,
        worker: { name: 'Sam Worker', mobileMasked: '+61 4•• ••• 678' },
        sections: { sec_0: { complete: true }, sec_1: { complete: false } },
        quiz: { passed: false, attempts: 1 },
      },
    });
    if (opened.state !== 'open') throw new Error('expected open');
    expect(opened.induction.sections[1]?.blocks).toEqual([
      { type: 'video', fileId: 'fil_1', title: null },
      { type: 'swms', documentId: 'doc_1', title: 'SWMS 03' },
    ]);
  });

  it('treats an invalid or expired link the same way, without a site', async () => {
    fake.on('POST', A, () => fakeProblem(401, 'access_link.invalid'));
    await expect(createInductionAccessApi().open('arl_bad', null)).resolves.toEqual({
      state: 'expired',
      site: null,
    });
    fake.on('POST', A, () => fakeProblem(422, 'validation_failed'));
    await expect(createInductionAccessApi().open('nonsense', null)).resolves.toMatchObject({
      state: 'expired',
    });
    fake.on('GET', A, () => fakeProblem(401, 'access_link.invalid'));
    await expect(createInductionAccessApi().open('continue', null)).resolves.toMatchObject({
      state: 'expired',
    });
  });

  it('sends the code to an E.164 mobile and verifies with the details typed before it', async () => {
    fake.on('POST', `${A}/codes`, () => ({ channel: 'sms', to: '+61 4•• ••• 678' }));
    fake.on('POST', `${A}/verify`, () => access({ verified: true }));
    fake.on('GET', `${A}/completion`, () => completion());
    const api = createInductionAccessApi();
    const sent = await api.sendCode(
      '',
      {
        name: ' Sam Worker ',
        companyId: 'cmp_1',
        companyName: 'Brightwire',
        mobile: '0412 345 678',
      },
      { kind: 'sms' },
    );
    expect(sent.sentTo).toBe('+61 4•• ••• 678');
    expect(fake.callsTo('POST', `${A}/codes`)[0]?.init.body).toEqual({
      channel: 'sms',
      to: '+61412345678',
    });
    await api.verify('', '123456');
    expect(fake.callsTo('POST', `${A}/verify`)[0]?.init.body).toEqual({
      code: '123456',
      fullName: 'Sam Worker',
      companyId: 'cmp_1',
    });
  });

  it('refuses a landline before calling the server', async () => {
    await expect(
      createInductionAccessApi().sendCode(
        '',
        { name: 'Sam', companyId: null, companyName: 'Sam Tiling', mobile: '02 9000 0000' },
        { kind: 'sms' },
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(fake.callsTo('POST', `${A}/codes`)).toHaveLength(0);
  });

  it('records a section by index with the seconds spent, then rereads the worker', async () => {
    fake.on('GET', A, () => access({ verified: true }));
    fake.on('GET', `${A}/completion`, () => completion({ sectionsViewed: [0, 1] }));
    fake.on('POST', `${A}/progress`, () => completion());
    const api = createInductionAccessApi();
    await api.open('continue', null);
    const progress = await api.completeSection('', 'sec_1', 41.6);
    expect(fake.callsTo('POST', `${A}/progress`)[0]?.init.body).toEqual({
      section: 1,
      seconds: 42,
    });
    expect(progress.sections).toEqual({ sec_0: { complete: true }, sec_1: { complete: true } });
  });

  it('turns the quiz into answer indexes and the result into the screen’s shape', async () => {
    fake.on('GET', A, () => access({ verified: true }));
    fake.on('GET', `${A}/completion`, () => completion());
    fake.on('POST', `${A}/quiz-attempts`, () => ({
      attempt: 2,
      score: 50,
      passed: false,
      criticalMissed: true,
      reviewSections: [0],
      seeSiteOffice: false,
    }));
    const api = createInductionAccessApi();
    await api.open('continue', null);
    const questions = await api.quizQuestions('');
    expect(questions[0]).toEqual({
      id: 'q1',
      text: 'What do you wear?',
      options: [
        { id: '0', text: 'Hat' },
        { id: '1', text: 'Nothing' },
      ],
    });
    const { result } = await api.submitQuiz('', { q1: '0', q2: '1' });
    expect(fake.callsTo('POST', `${A}/quiz-attempts`)[0]?.init.body).toEqual({
      answers: [
        { questionId: 'q1', answerIndex: 0 },
        { questionId: 'q2', answerIndex: 1 },
      ],
    });
    expect(result).toMatchObject({
      passed: false,
      correct: 1,
      total: 2,
      needed: 2,
      missedCritical: true,
      reviewSectionIds: ['sec_0'],
      attempt: 2,
    });
  });

  it('signs with the strokes as path data and the device time', async () => {
    fake.on('POST', `${A}/sign`, () => completion({ status: 'completed' }));
    fake.on('GET', A, () => access({ verified: true }));
    fake.on('GET', `${A}/completion`, () =>
      completion({ status: 'completed', completedAt: '2026-10-02T01:00:00Z' }),
    );
    const progress = await createInductionAccessApi().sign('', {
      statementsAccepted: 2,
      name: ' Sam Worker ',
      signature: {
        method: 'drawn',
        strokes: [
          [
            { x: 0.1, y: 0.5 },
            { x: 0.2, y: 0.6 },
          ],
        ],
      },
      deviceTime: '2026-10-02T11:00:00+10:00',
    });
    expect(fake.callsTo('POST', `${A}/sign`)[0]?.init.body).toEqual({
      typedName: 'Sam Worker',
      signature: { format: 'svg', data: 'M30 50L60 60' },
      fitForWork: true,
      agreed: true,
      clientAt: '2026-10-02T11:00:00+10:00',
    });
    expect(progress.completion).toMatchObject({ version: 2 });
  });

  it('asks for a short-lived file address when a video shows', async () => {
    fake.on('GET', `${A}/files/{fileId}/download`, () => ({
      url: 'https://files.test/v.mp4',
      expiresAt: '',
    }));
    await expect(createInductionAccessApi().fileUrl('fil_1')).resolves.toBe(
      'https://files.test/v.mp4',
    );
  });

  it('formats mobiles and strokes', () => {
    expect(toE164('0412 345 678')).toBe('+61412345678');
    expect(toE164('+61 412 345 678')).toBe('+61412345678');
    expect(strokesToPath([[], [{ x: 1, y: 1 }]])).toBe('M300 100');
  });
});
