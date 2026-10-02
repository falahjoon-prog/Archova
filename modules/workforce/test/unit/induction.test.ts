import { describe, expect, it } from 'vitest';
import {
  INDUCTION_SECTIONS,
  addMonths,
  completionStatus,
  contentHash,
  contentProblems,
  normaliseContent,
  requiredVersion,
  scoreQuiz,
  sectionHash,
  templateContent,
  type InductionContent,
  type InductionQuestion,
} from '../../src/domain/induction';

const q = (section: InductionQuestion['section'], answerIndex = 0, critical = false) => ({
  id: `q-${section}`,
  section,
  question: `About ${section}?`,
  options: ['A', 'B'],
  answerIndex,
  critical,
});

function complete(): InductionContent {
  const c = templateContent();
  return {
    ...c,
    sections: c.sections.map((s) => ({ ...s, blocks: [{ type: 'text', body: 'Content' }] })),
    quiz: [
      q('emergencies_and_first_aid', 0, true),
      q('site_hazards', 1),
      q('high_risk_work_and_permits', 0, true),
      q('incident_reporting', 0),
      q('ppe', 1),
    ],
  };
}

describe('induction rules (compliance/04 §2–§4)', () => {
  it('starts from the nine required sections and an 80% pass mark', () => {
    const t = templateContent();
    expect(t.sections.map((s) => s.key)).toEqual([...INDUCTION_SECTIONS]);
    expect(t.passMark).toBe(80);
  });

  it('lists what stops publishing', () => {
    expect(contentProblems(complete())).toEqual([]);
    const c = complete();
    c.sections[2]!.blocks = [{ type: 'text', body: '  ' }];
    c.quiz = c.quiz.filter((x) => x.section !== 'incident_reporting').slice(0, 2);
    expect(contentProblems(c).map((p) => p.path)).toEqual([
      'sections/emergencies_and_first_aid',
      'quiz',
      'quiz/high_risk_work_and_permits',
      'quiz/incident_reporting',
    ]);
  });

  it('makes emergency and permit questions critical and gives new questions an id', () => {
    const c = normaliseContent(
      { ...complete(), quiz: [{ ...q('emergencies_and_first_aid'), id: '' }, q('ppe')] },
      () => 'qnew',
    );
    expect(c.quiz.map((x) => [x.id, x.critical])).toEqual([
      ['qnew', true],
      ['q-ppe', false],
    ]);
  });

  it('needs the pass mark and every critical question right', () => {
    const c = complete();
    const right = Object.fromEntries(c.quiz.map((x) => [x.id, x.answerIndex]));
    expect(scoreQuiz(c, right)).toEqual({
      score: 100,
      criticalOk: true,
      passed: true,
      reviewSections: [],
    });
    // 4 of 5 is 80%, but the wrong one is critical.
    const missedCritical = { ...right, 'q-emergencies_and_first_aid': 1 };
    expect(scoreQuiz(c, missedCritical)).toMatchObject({
      score: 80,
      criticalOk: false,
      passed: false,
      reviewSections: [2],
    });
    expect(scoreQuiz(c, { ...right, 'q-ppe': 0 })).toMatchObject({ score: 80, passed: true });
  });

  it('hashes content stably and per section', () => {
    const a = complete();
    const b = structuredClone(a);
    expect(contentHash(a, 'decl')).toBe(contentHash(b, 'decl'));
    expect(contentHash(a, 'decl')).not.toBe(contentHash(a, 'other'));
    b.sections[1]!.blocks = [{ type: 'text', body: 'Changed' }];
    expect(sectionHash(a, 0)).toBe(sectionHash(b, 0));
    expect(sectionHash(a, 1)).not.toBe(sectionHash(b, 1));
  });

  it('requires the newest "everyone redo" version once its grace days have passed', () => {
    const now = new Date('2026-10-10T00:00:00Z');
    const v = (number: number, redo: 'all' | 'none', from: string) => ({
      id: `v${number}`,
      number,
      redo,
      requiredFrom: new Date(from),
    });
    const versions = [
      v(1, 'all', '2026-09-01T00:00:00Z'),
      v(2, 'none', '2026-10-01T00:00:00Z'),
      v(3, 'all', '2026-10-20T00:00:00Z'),
    ];
    expect(requiredVersion(versions, now)?.number).toBe(1);
    expect(requiredVersion(versions, new Date('2026-10-21T00:00:00Z'))?.number).toBe(3);
    expect(requiredVersion([], now)).toBeNull();
  });

  it('works out the register status', () => {
    const done = { status: 'completed' as const, versionNumber: 1, expiresOn: '2027-10-01' };
    expect(completionStatus(null, 1, '2026-10-02')).toBe('not_inducted');
    expect(completionStatus({ ...done, status: 'in_progress' }, 1, '2026-10-02')).toBe(
      'in_progress',
    );
    expect(completionStatus(done, 1, '2026-10-02')).toBe('current');
    expect(completionStatus(done, 2, '2026-10-02')).toBe('needs_reinduction');
    expect(completionStatus(done, 1, '2027-10-02')).toBe('expired');
  });

  it('adds calendar months, clamped to the month end', () => {
    expect(addMonths('2026-10-02', 12)).toBe('2027-10-02');
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
  });
});
