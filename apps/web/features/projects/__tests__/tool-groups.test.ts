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
      'Specifications',
      'Coordination',
      'Transmittals',
      'RFIs',
      'Submittals',
      'Correspondence',
      'Meetings',
      'Site diary',
      'Delay register',
      'Programme',
      'Attendance',
      'Defects',
      'Inspections',
      'Observations',
      'SWMS',
      'Incidents',
      'Safety signals',
      'Inductions',
      'Contracts',
      'Payment claims',
      'T&M tickets',
      'Budget',
      'Owner portal',
      'Tender packages',
      'Estimates',
      'Cost library',
      'Late submissions',
      'Imports',
      'SharePoint and Drive',
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
      'Specifications',
      'Transmittals',
      'Defects',
      'Tender packages',
      'Estimates',
      'Cost library',
    ]);
  });

  it('shows everything to org admins', () => {
    const groups = projectToolGroups('acme', 'prj_1', { orgRole: 'admin', toolLevels: {} });
    expect(labels(groups)).toContain('RFIs');
  });

  it('puts tools into named categories and drops empty ones', () => {
    const groups = projectToolGroups('acme', 'prj_1', {
      orgRole: null,
      toolLevels: { defects: 'read' },
    });
    expect(groups.filter((g) => g.id).map((g) => [g.label, g.items.map((i) => i.label)])).toEqual([
      ['Quality & safety', ['Defects']],
      ['Estimating', ['Tender packages', 'Estimates', 'Cost library']],
    ]);
  });

  it('adds a quick-add link only where the caller can create', () => {
    const items = projectToolGroups('acme', 'prj_1', {
      orgRole: null,
      toolLevels: { documents: 'read', defects: 'standard', rfis: 'read' },
    }).flatMap((g) => g.items);
    const href = (label: string) => items.find((i) => i.label === label)?.createHref;
    expect(href('Defects')).toBe('/acme/projects/prj_1/defects/new');
    expect(href('RFIs')).toBeUndefined();
    expect(href('Transmittals')).toBeUndefined();
  });
});
