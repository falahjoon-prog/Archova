import { describe, expect, it } from 'vitest';
import { encodeId, uuidv7 } from '@archova/domain';
import { parseScopes } from '../../src/domain/scopes';

describe('parseScopes', () => {
  const a = uuidv7();
  const b = uuidv7();
  const pa = encodeId('project', a);
  const pb = encodeId('project', b);

  it('reads the device format: modules per project, then org', () => {
    expect(parseScopes(`project:${pa}:defects,diary;project:${pb}:defects;org`)).toEqual({
      org: true,
      projects: [
        { projectId: a, modules: ['defects', 'diary'] },
        { projectId: b, modules: ['defects'] },
      ],
    });
    expect(parseScopes('org')).toEqual({ org: true, projects: [] });
  });

  it('merges a project listed twice', () => {
    expect(parseScopes(`project:${pa}:defects;project:${pa}:diary,defects`)?.projects).toEqual([
      { projectId: a, modules: ['defects', 'diary'] },
    ]);
  });

  it('refuses anything else', () => {
    for (const bad of [
      '',
      'projects',
      `project:${pa}`,
      `project:${pa}:`,
      `project:${a}:defects`,
      `project:${pa}:Defects`,
      `project:${pa}:defects:extra`,
      `org;`,
    ])
      expect(parseScopes(bad), bad).toBeNull();
  });
});
