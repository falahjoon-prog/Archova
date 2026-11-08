import { describe, expect, it } from 'vitest';
import type { ErrorView } from '@/shared/lib/errors';
import { errorHelpAnswer, navHelpAnswer } from '../data/help';

const view = (over: Partial<ErrorView>): ErrorView => ({
  message: 'm',
  fieldErrors: {},
  traceId: null,
  status: 500,
  code: null,
  ...over,
});

describe('navHelpAnswer', () => {
  it('says where a tool lives and how to add one', () => {
    expect(navHelpAnswer('Where do I find RFIs?')?.text).toMatch(/Communication.*\+/);
    expect(navHelpAnswer('how do I log a defect')?.text).toMatch(/Quality & safety/);
    expect(navHelpAnswer('where is the bid board')?.text).toMatch(/Tendering/);
  });
  it('explains starring', () => {
    expect(navHelpAnswer('how do I favourite a tool')?.text).toMatch(/Starred/);
  });
  it('leaves other questions to the records', () => {
    expect(navHelpAnswer('how many open RFIs are overdue?')).toBeNull();
  });
});

describe('errorHelpAnswer', () => {
  it('suggests a fix per kind of failure', () => {
    expect(errorHelpAnswer(view({ status: null })).text).toMatch(/connection/);
    expect(errorHelpAnswer(view({ status: 401 })).text).toMatch(/Sign in again/);
    expect(errorHelpAnswer(view({ status: 403 })).text).toMatch(/admin/);
    expect(errorHelpAnswer(view({ status: 409 })).text).toMatch(/Reload/);
    expect(errorHelpAnswer(view({ status: 503 })).text).toMatch(/Archova's side/);
  });
  it('names the fields that failed validation and the support reference', () => {
    const a = errorHelpAnswer(
      view({ status: 422, fieldErrors: { subject: 'Required' }, traceId: 'trc_1' }),
    );
    expect(a.text).toMatch(/subject \(Required\)/);
    expect(a.text).toMatch(/trc_1/);
  });
});
