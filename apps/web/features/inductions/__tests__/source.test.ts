import { beforeEach, describe, expect, it } from 'vitest';
import {
  PREVIEW_CODE,
  correctNeeded,
  inductionSource as src,
  resetInductionPreview,
} from '../worker/data/source';
import type { OpenedInduction } from '../worker/lib/types';

type Open = Extract<OpenedInduction, { state: 'open' }>;

async function verifiedSession(mobile = '0412 345 678') {
  const opened = (await src.open('demo', null)) as Open;
  const sid = opened.sessionId;
  await src.sendCode(
    sid,
    { name: 'Sam Worker', companyId: 'cmp_elec', companyName: 'Brightwire Electrical', mobile },
    { kind: 'sms' },
  );
  await src.verify(sid, PREVIEW_CODE);
  return { sid, induction: opened.induction };
}

async function finishSections(sid: string, induction: Open['induction']) {
  for (const s of induction.sections) {
    if (s.type === 'video') await src.reportWatch(sid, s.id, s.durationS);
    else if (s.type === 'slides')
      for (let i = 0; i < s.pages.length; i++) await src.viewPage(sid, s.id, i);
    else if (s.type === 'swms')
      for (const d of s.documents) await src.openDocument(sid, s.id, d.id);
    else await src.completeSection(sid, s.id);
  }
}

const ALL_RIGHT = { q1: 'b', q2: 'a', q3: 'b', q4: 'a', q5: 'c' };

beforeEach(() => resetInductionPreview());

describe('induction preview source', () => {
  it('says when a link has expired or been revoked', async () => {
    await expect(src.open('expired', null)).resolves.toMatchObject({ state: 'expired' });
    await expect(src.open('revoked', null)).resolves.toMatchObject({ state: 'revoked' });
    await expect(src.open('continue', null)).resolves.toMatchObject({ state: 'expired' });
  });

  it('needs the code before anything is saved', async () => {
    const opened = (await src.open('demo', null)) as Open;
    await expect(src.completeSection(opened.sessionId, 'sec_rules')).rejects.toMatchObject({
      status: 403,
    });
    await src.sendCode(
      opened.sessionId,
      { name: 'Sam', companyId: null, companyName: 'Sam Tiling', mobile: '0412 345 678' },
      { kind: 'sms' },
    );
    await expect(src.verify(opened.sessionId, '000000')).rejects.toMatchObject({ status: 422 });
    await expect(src.verify(opened.sessionId, PREVIEW_CODE)).resolves.toMatchObject({
      verified: true,
      worker: { mobileMasked: '•••• ••• 678' },
    });
  });

  it('counts a video only once watched to the end (IND-AC4)', async () => {
    const { sid } = await verifiedSession();
    let p = await src.reportWatch(sid, 'sec_welcome', 10);
    expect(p.sections.sec_welcome).toMatchObject({ complete: false, watchedS: 10 });
    p = await src.reportWatch(sid, 'sec_welcome', 5);
    expect(p.sections.sec_welcome?.watchedS).toBe(10);
    p = await src.reportWatch(sid, 'sec_welcome', 24);
    expect(p.sections.sec_welcome?.complete).toBe(true);
  });

  it('scores the quiz on the server: the pass mark, and any critical question wrong fails (IND-AC5)', async () => {
    expect(correctNeeded(5, 80)).toBe(4);
    expect(correctNeeded(10, 50)).toBe(7);
    const { sid, induction } = await verifiedSession();
    await expect(src.quizQuestions(sid)).rejects.toMatchObject({ status: 409 });
    await finishSections(sid, induction);
    const questions = await src.quizQuestions(sid);
    expect(questions[0]).not.toHaveProperty('correct');

    const critical = await src.submitQuiz(sid, { ...ALL_RIGHT, q1: 'a' });
    expect(critical.result).toMatchObject({ passed: false, correct: 4, missedCritical: true });
    expect(critical.result.reviewSectionIds).toHaveLength(1);

    const one = await src.submitQuiz(sid, { ...ALL_RIGHT, q5: 'a' });
    expect(one.result).toMatchObject({ passed: true, correct: 4, attempt: 2 });
    expect(one.progress.quiz).toEqual({ passed: true, attempts: 2 });
  });

  it('signs only when everything is done, against a hash of the version shown (IND-AC6)', async () => {
    const { sid, induction } = await verifiedSession();
    const signature = { method: 'typed', name: 'Sam Worker' } as const;
    const sign = () =>
      src.sign(sid, {
        statementsAccepted: induction.declaration.length,
        name: 'Sam Worker',
        signature,
        deviceTime: '2026-10-02T09:00:00+10:00',
      });
    await expect(sign()).rejects.toMatchObject({ status: 409 });
    await finishSections(sid, induction);
    await src.submitQuiz(sid, ALL_RIGHT);
    await expect(sign()).rejects.toMatchObject({ status: 409 });
    await src.saveCredential(sid, {
      type: 'white_card',
      label: 'White card',
      number: 'CGI 123',
      state: 'NSW',
      expiry: null,
      photo: null,
    });
    await expect(
      src.sign(sid, { statementsAccepted: 2, name: 'Sam', signature, deviceTime: '' }),
    ).rejects.toMatchObject({ status: 422 });
    const p = await sign();
    expect(p.completion).toMatchObject({ version: 4, signatureMethod: 'typed' });
    expect(p.completion?.versionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(p.credentials[0]?.status).toBe('recorded');
  });

  it('welcomes back a known mobile with their white card on file', async () => {
    const { sid } = await verifiedSession('0400 000 111');
    const opened = (await src.open('continue', sid)) as Open;
    expect(opened.progress.returning).toBe(true);
    expect(opened.progress.credentials).toEqual([
      expect.objectContaining({ type: 'white_card', status: 'sighted' }),
    ]);
  });
});
