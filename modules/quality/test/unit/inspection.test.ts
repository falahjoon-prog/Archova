import { describe, expect, it } from 'vitest';
import {
  failedItems,
  isAnswered,
  missingRequired,
  missingRequiredIn,
  responseProblem,
  sectionSummaries,
  type ItemSpec,
  type ResponseState,
} from '../../src/domain/inspection';

const item = (over: Partial<ItemSpec>): ItemSpec => ({
  id: 'i1',
  prompt: 'Check',
  responseType: 'pass_fail_na',
  options: [],
  required: true,
  createsDefectOnFail: false,
  ...over,
});

describe('responseProblem', () => {
  it('needs pass, fail or n/a for a pass/fail item', () => {
    expect(responseProblem(item({}), { result: 'fail' })).toBeNull();
    expect(responseProblem(item({}), {})).not.toBeNull();
  });
  it('checks each response type', () => {
    expect(responseProblem(item({ responseType: 'yes_no' }), { value: true })).toBeNull();
    expect(responseProblem(item({ responseType: 'yes_no' }), { value: 'yes' })).not.toBeNull();
    expect(responseProblem(item({ responseType: 'number' }), { value: 12.5 })).toBeNull();
    expect(responseProblem(item({ responseType: 'number' }), { value: NaN })).not.toBeNull();
    expect(responseProblem(item({ responseType: 'text' }), { value: '  ' })).not.toBeNull();
    expect(
      responseProblem(item({ responseType: 'select', options: ['a', 'b'] }), { value: 'b' }),
    ).toBeNull();
    expect(
      responseProblem(item({ responseType: 'select', options: ['a', 'b'] }), { value: 'c' }),
    ).not.toBeNull();
    expect(responseProblem(item({ responseType: 'photo' }), { fileIds: [] })).not.toBeNull();
    expect(responseProblem(item({ responseType: 'photo' }), { fileIds: ['f'] })).toBeNull();
    expect(responseProblem(item({ responseType: 'signature' }), { value: 'J Smith' })).toBeNull();
  });
});

describe('completeness', () => {
  const a = item({ id: 'a' });
  const b = item({ id: 'b', required: false });
  const c = item({ id: 'c', responseType: 'text' });
  const answers = new Map<string, ResponseState>([
    ['a', { value: null, result: 'fail', fileIds: [] }],
  ]);
  it('lists unanswered required items only', () => {
    expect(missingRequired([a, b, c], answers).map((i) => i.id)).toEqual(['c']);
  });
  it('lists failed items', () => {
    expect(failedItems([a, b, c], answers).map((i) => i.id)).toEqual(['a']);
  });
  it('treats a missing answer as unanswered', () => {
    expect(isAnswered(a, undefined)).toBe(false);
  });
});

describe('date items and N/A overrides', () => {
  it('accepts an ISO date only', () => {
    const d = item({ responseType: 'date' });
    expect(responseProblem(d, { value: '2026-11-07' })).toBeNull();
    expect(responseProblem(d, { value: 'tomorrow' })).not.toBeNull();
  });
  it('lets any item be marked N/A', () => {
    expect(responseProblem(item({ responseType: 'number' }), { result: 'na' })).toBeNull();
    expect(responseProblem(item({ responseType: 'number' }), { result: 'fail' })).not.toBeNull();
  });
});

describe('sectionSummaries', () => {
  it('rolls up each section and ignores N/A sections when checking required items', () => {
    const items = [
      { ...item({ id: 'a' }), section: 'A' },
      { ...item({ id: 'b', responseType: 'number' }), section: 'A' },
      { ...item({ id: 'c' }), section: 'B' },
    ];
    const answers = new Map<string, ResponseState>([
      ['a', { value: null, result: 'fail', fileIds: [] }],
      ['b', { value: null, result: 'na', fileIds: [] }],
    ]);
    const out = sectionSummaries(items, answers, new Set(['B']));
    expect(out.find((s) => s.section === 'A')).toMatchObject({ fail: 1, na: 1, unanswered: 0 });
    expect(out.find((s) => s.section === 'B')).toMatchObject({ na: 1, unanswered: 0, isNa: true });
    expect(missingRequiredIn(items, answers, new Set(['B']))).toHaveLength(0);
    expect(missingRequiredIn(items, answers, new Set())).toHaveLength(1);
  });
});
