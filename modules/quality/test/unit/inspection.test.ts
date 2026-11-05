import { describe, expect, it } from 'vitest';
import {
  failedItems,
  isAnswered,
  missingRequired,
  responseProblem,
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
