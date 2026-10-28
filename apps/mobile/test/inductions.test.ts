import { describe, expect, it, vi } from 'vitest';
import type { InductionCompletion } from '@archova/contracts';
import {
  nextStep,
  quizOutcome,
  recordSectionSeen,
  signInduction,
  signaturePath,
  thinStroke,
} from '../features/inductions';

const completion = (over: Record<string, unknown>) =>
  ({
    status: 'in_progress',
    sectionsViewed: [],
    quiz: { attempts: 0, failedAttempts: 0, passed: false, lastScore: null },
    credentials: [],
    content: { sections: [{}, {}, {}], quiz: [{}], passMark: 80 },
    ...over,
  }) as unknown as InductionCompletion;

describe('nextStep', () => {
  it('walks the sections in order, skipping those already seen', () => {
    expect(nextStep(completion({}))).toEqual({ kind: 'section', index: 0 });
    expect(nextStep(completion({ sectionsViewed: [0, 2] }))).toEqual({ kind: 'section', index: 1 });
  });

  it('goes to the quiz once every section is seen', () => {
    expect(nextStep(completion({ sectionsViewed: [0, 1, 2] }))).toEqual({ kind: 'quiz' });
  });

  it('asks for a white card after the quiz when none is on file', () => {
    const passed = { attempts: 1, failedAttempts: 0, passed: true, lastScore: 90 };
    expect(nextStep(completion({ sectionsViewed: [0, 1, 2], quiz: passed }))).toEqual({
      kind: 'credentials',
    });
    expect(
      nextStep(
        completion({
          sectionsViewed: [0, 1, 2],
          quiz: passed,
          credentials: [{ kind: 'white_card' }],
        }),
      ),
    ).toEqual({ kind: 'sign' });
  });

  it('is done when the server says completed', () => {
    expect(nextStep(completion({ status: 'completed' }))).toEqual({ kind: 'done' });
  });
});

describe('quizOutcome', () => {
  it('points a failed worker back to the sections they missed', () => {
    const m = quizOutcome({
      passed: false,
      score: 60,
      seeSiteOffice: false,
      reviewSections: [1, 3],
    });
    expect(m).toEqual({
      title: 'Not passed yet (60%)',
      detail: 'Go back over section 2, section 4 and try again.',
    });
  });

  it('sends them to the office after three failures', () => {
    expect(
      quizOutcome({ passed: false, score: 40, seeSiteOffice: true, reviewSections: [] }).title,
    ).toBe('See the site office');
  });
});

describe('signature', () => {
  it('writes one run per stroke and keeps a single touch visible', () => {
    expect(
      signaturePath([
        [
          { x: 1.04, y: 2 },
          { x: 5, y: 6.26 },
        ],
        [{ x: 9, y: 9 }],
        [],
      ]),
    ).toBe('M1 2 L5 6.3 M9 9 L9.1 9');
  });

  it('thins close points but keeps the end', () => {
    const pts = [0, 0.5, 1, 3, 3.5].map((x) => ({ x, y: 0 }));
    expect(thinStroke(pts).map((p) => p.x)).toEqual([0, 3, 3.5]);
  });
});

describe('induction calls', () => {
  it('records a section with the time spent', async () => {
    const POST = vi.fn().mockResolvedValue({ data: {}, response: { ok: true, status: 200 } });
    await recordSectionSeen({ POST } as never, { orgId: 'o', projectId: 'p' }, 'inc_1', {
      section: 2,
      seconds: 40,
    });
    expect(POST).toHaveBeenCalledWith(
      '/v1/orgs/{orgId}/projects/{projectId}/induction-completions/{completionId}/progress',
      {
        params: { path: { orgId: 'o', projectId: 'p', completionId: 'inc_1' } },
        body: { section: 2, seconds: 40 },
      },
    );
  });

  it('signs with the declaration accepted and the device time', async () => {
    const POST = vi.fn().mockResolvedValue({ data: {}, response: { ok: true, status: 200 } });
    await signInduction({ POST } as never, { orgId: 'o', projectId: 'p' }, 'inc_1', {
      typedName: 'Sam Worker',
      signaturePath: 'M1 2 L3 4',
      fitForWork: true,
      agreed: true,
      clientAt: '2026-10-28T15:00:00Z',
    });
    expect(POST.mock.calls[0]![1].body).toEqual({
      typedName: 'Sam Worker',
      signature: { format: 'svg', data: 'M1 2 L3 4' },
      fitForWork: true,
      agreed: true,
      clientAt: '2026-10-28T15:00:00Z',
    });
  });
});
