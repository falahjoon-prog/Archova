// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', async () => {
  const { createQueries } = await import('@archova/query');
  return { ...fake.module, queries: createQueries(fake.module.api as never) };
});

const { AuditLogScreen } = await import('../screens/AuditLogScreen');
const { startOfLocalDay } = await import('../lib/types');

const AUDIT = '/v1/orgs/{orgId}/audit-log';
const line = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  at: '2026-11-06T01:00:00.000Z',
  action: 'rfis.rfi.created',
  module: 'rfis',
  summary: 'Rfi created',
  entityType: 'rfi',
  projectId: 'prj_a',
  projectName: 'Alpha Tower',
  actor: { kind: 'user', id: 'usr_1', name: 'Pat Manager' },
  ...over,
});

beforeEach(() => {
  fake.reset();
  fake.on('GET', '/v1/orgs/{orgId}/projects', () => ({
    data: [{ id: 'prj_a', name: 'Alpha Tower' }],
    nextCursor: null,
  }));
});

describe('AuditLogScreen', () => {
  it('shows who did what, and where, with system and link actors named plainly', async () => {
    fake.on('GET', AUDIT, () => ({
      data: [
        line('evt_1'),
        line('evt_2', {
          actor: { kind: 'system', id: null, name: null },
          projectId: null,
          projectName: null,
        }),
        line('evt_3', { actor: { kind: 'link', id: null, name: null } }),
      ],
      nextCursor: null,
    }));
    renderInProject(<AuditLogScreen />);
    const table = await screen.findByRole('table', { name: /Audit log/ });
    expect(within(table).getByText('Pat Manager')).toBeTruthy();
    expect(within(table).getByText('System')).toBeTruthy();
    expect(within(table).getByText('Access link')).toBeTruthy();
    expect(within(table).getByText('Company')).toBeTruthy();
    expect(within(table).getAllByText('Alpha Tower').length).toBe(2);
  });

  it('loads older entries with the cursor', async () => {
    const calls: Array<Record<string, unknown>> = [];
    fake.on('GET', AUDIT, (req: { params?: { query?: Record<string, unknown> } }) => {
      const q = req.params?.query ?? {};
      calls.push(q);
      return q.cursor
        ? {
            data: [line('evt_old', { actor: { kind: 'user', id: 'usr_2', name: 'Older Person' } })],
            nextCursor: null,
          }
        : { data: [line('evt_new')], nextCursor: 'c1' };
    });
    renderInProject(<AuditLogScreen />);
    await screen.findByText('Pat Manager');
    await userEvent.click(screen.getByRole('button', { name: 'Load older entries' }));
    expect(await screen.findByText('Older Person')).toBeTruthy();
    expect(calls.some((c) => c.cursor === 'c1')).toBe(true);
  });

  it('says so when nothing is recorded', async () => {
    fake.on('GET', AUDIT, () => ({ data: [], nextCursor: null }));
    renderInProject(<AuditLogScreen />);
    expect(await screen.findByText('Nothing recorded yet')).toBeTruthy();
  });
});

describe('startOfLocalDay', () => {
  it('ignores a malformed date and moves to the next day for an exclusive end', () => {
    expect(startOfLocalDay('')).toBeUndefined();
    expect(startOfLocalDay('nope')).toBeUndefined();
    const a = new Date(startOfLocalDay('2026-11-06')!);
    const b = new Date(startOfLocalDay('2026-11-06', 1)!);
    expect(b.getTime() - a.getTime()).toBeGreaterThanOrEqual(23 * 3600_000);
    expect(b.getTime() - a.getTime()).toBeLessThanOrEqual(25 * 3600_000);
  });
});
