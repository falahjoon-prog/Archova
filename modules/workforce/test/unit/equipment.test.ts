import { describe, expect, it } from 'vitest';
import { nextPlacement } from '../../src/domain/equipment';

const free = { status: 'available', currentProjectId: null } as const;
const working = { status: 'in_use', currentProjectId: 'p1' } as const;

describe('nextPlacement', () => {
  it('puts equipment to work when it is sent to a project', () => {
    expect(nextPlacement(free, { currentProjectId: 'p2' })).toEqual({
      ok: true,
      next: { status: 'in_use', currentProjectId: 'p2' },
    });
    expect(
      nextPlacement({ status: 'maintenance', currentProjectId: null }, { currentProjectId: 'p2' }),
    ).toMatchObject({ ok: true, next: { status: 'in_use' } });
  });

  it('frees equipment taken off site, leaving maintenance and retired as they are', () => {
    expect(nextPlacement(working, { currentProjectId: null })).toEqual({
      ok: true,
      next: { status: 'available', currentProjectId: null },
    });
    expect(
      nextPlacement({ status: 'maintenance', currentProjectId: null }, { currentProjectId: null }),
    ).toEqual({ ok: true, next: { status: 'maintenance', currentProjectId: null } });
  });

  it('clears the project for any other status', () => {
    expect(nextPlacement(working, { status: 'maintenance' })).toEqual({
      ok: true,
      next: { status: 'maintenance', currentProjectId: null },
    });
  });

  it('refuses in use without a project, and a project without in use', () => {
    expect(nextPlacement(free, { status: 'in_use' })).toMatchObject({ ok: false });
    expect(nextPlacement(working, { status: 'in_use', currentProjectId: null })).toMatchObject({
      ok: false,
    });
    expect(nextPlacement(free, { status: 'retired', currentProjectId: 'p1' })).toMatchObject({
      ok: false,
    });
    expect(nextPlacement(free, { status: 'in_use', currentProjectId: 'p1' })).toMatchObject({
      ok: true,
    });
  });
});
