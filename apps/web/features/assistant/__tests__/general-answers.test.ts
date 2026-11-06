import { describe, expect, it } from 'vitest';
import { previewAnswer } from '../data/preview-answers';

const noProject = { projectId: null } as Parameters<typeof previewAnswer>[1];
const today = '2026-11-06' as Parameters<typeof previewAnswer>[2];

describe('Ask Nova outside a project', () => {
  it('answers a greeting conversationally', async () => {
    const a = await previewAnswer('hi', noProject, today);
    expect(a.kind).toBe('answer');
    expect(a.text).toMatch(/I'm Nova/);
  });

  it('explains what it can do', async () => {
    const a = await previewAnswer('What can you do?', noProject, today);
    expect(a.kind).toBe('answer');
  });

  it('only asks to open a project for project questions', async () => {
    const a = await previewAnswer('how many open RFIs?', noProject, today);
    expect(a.kind).toBe('not_found');
    expect(a.text).toMatch(/project open/);
  });
});
