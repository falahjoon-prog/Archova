import { describe, expect, it } from 'vitest';
import { DEFAULT_PERMISSION_TEMPLATES } from '../src/permissions/templates';

// The warranty claim summary is shown in full to anyone who reads the defects tool without company scoping, so the
// templates that do are pinned here. Adding a template or loosening a scope fails this test until Sam has looked.
describe('who reads every warranty claim', () => {
  const unscoped = DEFAULT_PERMISSION_TEMPLATES.filter(
    (t) => t.toolLevels.defects !== 'none' && !t.companyScopedTools.includes('defects'),
  ).map((t) => t.key);

  it('is limited to the known unscoped templates', () => {
    expect(unscoped.sort()).toEqual(
      [
        'client',
        'consultant',
        'project_admin',
        'project_manager',
        'site_manager',
        'superintendent',
      ].sort(),
    );
  });
  it('keeps subcontractors company scoped and never gives them admin on defects', () => {
    const sub = DEFAULT_PERMISSION_TEMPLATES.find((t) => t.key === 'subcontractor')!;
    expect(sub.companyScopedTools).toContain('defects');
    expect(sub.toolLevels.defects).not.toBe('admin');
  });
  it('gives only project admin, project manager and site manager the right to keep the register', () => {
    const managers = DEFAULT_PERMISSION_TEMPLATES.filter(
      (t) => t.toolLevels.defects === 'admin',
    ).map((t) => t.key);
    expect(managers.sort()).toEqual(['project_admin', 'project_manager', 'site_manager']);
  });
});
