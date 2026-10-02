import { describe, expect, it } from 'vitest';
import { projectToolGroups } from '../components/ProjectShell';

const labels = (groups: ReturnType<typeof projectToolGroups>) =>
  groups.flatMap((g) => g.items.map((i) => i.label));

describe('projectToolGroups', () => {
  it('shows every phase 1 tool while permissions load', () => {
    expect(labels(projectToolGroups('acme', 'prj_1', undefined))).toEqual([
      'Project home',
      'Documents',
      'Drawings',
      'RFIs',
      'Site diary',
      'Defects',
      'Tender packages',
    ]);
  });

  it('hides tools the caller cannot read', () => {
    const groups = projectToolGroups('acme', 'prj_1', {
      orgRole: null,
      toolLevels: { documents: 'read', defects: 'standard', rfis: 'none' },
    });
    expect(labels(groups)).toEqual([
      'Project home',
      'Documents',
      'Drawings',
      'Defects',
      'Tender packages',
    ]);
  });

  it('shows everything to org admins', () => {
    const groups = projectToolGroups('acme', 'prj_1', { orgRole: 'admin', toolLevels: {} });
    expect(labels(groups)).toContain('RFIs');
  });
});
