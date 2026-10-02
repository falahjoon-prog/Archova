import { describe, expect, it } from 'vitest';
import { PROBLEM_CODES, operations } from '../src';

describe('contract', () => {
  it('assigns every operation to a module (CI rule: no route without a module)', () => {
    for (const [id, op] of Object.entries(operations)) expect(op.module, id).toBeTruthy();
  });

  it('names permissions as <module>.<resource>.<action>', () => {
    for (const op of Object.values(operations)) {
      if (op.permission) expect(op.permission).toMatch(/^[a-z_]+\.[a-z_]+\.[a-z_]+$/);
    }
  });

  it('validates prefixed ids in org-scoped paths', () => {
    const op = operations.getProject;
    expect(
      op.params!.safeParse({
        orgId: 'org_0123456789ABCDEFGHJKMNPQRS',
        projectId: 'prj_0123456789ABCDEFGHJKMNPQRS',
      }).success,
    ).toBe(true);
    expect(
      op.params!.safeParse({ orgId: 'nope', projectId: 'prj_0123456789ABCDEFGHJKMNPQRS' }).success,
    ).toBe(false);
  });

  it('rejects unknown fields on request bodies', () => {
    expect(operations.createOrg.body!.safeParse({ name: 'x', isAdmin: true }).success).toBe(false);
  });

  it('maps every problem code to an HTTP error status', () => {
    for (const [code, status] of Object.entries(PROBLEM_CODES))
      expect(status, code).toBeGreaterThanOrEqual(400);
  });
});
