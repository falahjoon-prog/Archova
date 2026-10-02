import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PERMISSION_TEMPLATES,
  FOUNDATION_REGISTRY,
  NO_PERMISSIONS,
  TOOLS,
  evaluate,
  type EffectivePermissions,
} from '../src/permissions';

const subbie = DEFAULT_PERMISSION_TEMPLATES.find((t) => t.key === 'subcontractor')!;
const projectMember = (overrides: Partial<EffectivePermissions> = {}): EffectivePermissions => ({
  ...NO_PERMISSIONS,
  projectId: 'p1',
  isProjectMember: true,
  toolLevels: subbie.toolLevels,
  companyScopedTools: subbie.companyScopedTools,
  ...overrides,
});

describe('evaluate', () => {
  it('denies unknown keys (default deny)', () => {
    expect(
      evaluate({ ...NO_PERMISSIONS, orgRole: 'owner' }, 'nope.nope.nope', FOUNDATION_REGISTRY)
        .allow,
    ).toBe(false);
  });

  it('lets org owners and admins do everything', () => {
    for (const orgRole of ['owner', 'admin'] as const) {
      expect(
        evaluate({ ...NO_PERMISSIONS, orgRole }, 'platform.projects.create', FOUNDATION_REGISTRY)
          .allow,
      ).toBe(true);
      expect(
        evaluate({ ...NO_PERMISSIONS, orgRole }, 'files.objects.upload', FOUNDATION_REGISTRY).allow,
      ).toBe(true);
    }
  });

  it('denies org-level actions to members', () => {
    const d = evaluate(
      { ...NO_PERMISSIONS, orgRole: 'member' },
      'platform.projects.create',
      FOUNDATION_REGISTRY,
    );
    expect(d).toEqual({ allow: false, reason: 'org_role_required' });
  });

  it('applies the template tool level for project actions', () => {
    expect(evaluate(projectMember(), 'files.objects.read', FOUNDATION_REGISTRY).allow).toBe(true);
    expect(evaluate(projectMember(), 'files.objects.upload', FOUNDATION_REGISTRY)).toEqual({
      allow: false,
      reason: 'insufficient_level',
    });
    expect(
      evaluate(projectMember(), 'platform.project_members.manage', FOUNDATION_REGISTRY).allow,
    ).toBe(false);
  });

  it('requires project membership for project actions', () => {
    expect(
      evaluate(
        { ...NO_PERMISSIONS, orgRole: 'member' },
        'platform.projects.read',
        FOUNDATION_REGISTRY,
      ),
    ).toEqual({
      allow: false,
      reason: 'not_project_member',
    });
  });

  it('honours granular grants and explicit denies', () => {
    expect(
      evaluate(
        projectMember({ granular: ['files.objects.upload'] }),
        'files.objects.upload',
        FOUNDATION_REGISTRY,
      ).allow,
    ).toBe(true);
    expect(
      evaluate(
        projectMember({ orgRole: 'admin', denied: ['files.objects.read'] }),
        'files.objects.read',
        FOUNDATION_REGISTRY,
      ).allow,
    ).toBe(false);
  });

  it('seeds every tool in every default template', () => {
    for (const t of DEFAULT_PERMISSION_TEMPLATES) {
      expect(Object.keys(t.toolLevels).length).toBe(TOOLS.length);
    }
  });
});
