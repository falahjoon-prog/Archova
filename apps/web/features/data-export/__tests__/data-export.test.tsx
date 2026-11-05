// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { DataExportScreen } = await import('../screens/DataExportScreen');
const { fakeProblem } = await import('@/test/fake-api');

const E = '/v1/orgs/{orgId}/data-exports';
const ready = {
  id: 'dxp_1',
  status: 'ready',
  requestedBy: 'usr_1',
  createdAt: '2026-11-05T01:00:00Z',
  startedAt: '2026-11-05T01:00:05Z',
  finishedAt: '2026-11-05T01:20:00Z',
  expiresAt: '2026-11-12T01:20:00Z',
  sizeBytes: 5 * 1024 * 1024,
  sha256: 'ab'.repeat(32),
  tableCount: 150,
  fileCount: 42,
  skippedFileCount: 1,
  error: null,
};

beforeEach(() => {
  fake.reset();
  fake.on('GET', '/v1/auth/session', () => ({
    user: { id: 'usr_1', email: 'dana@acme.test', name: 'Dana' },
    csrfToken: 'x',
    expiresAt: '2026-11-30T00:00:00Z',
  }));
});

describe('DataExportScreen', () => {
  it('shows a finished export with its size, counts and checksum', async () => {
    fake.on('GET', E, () => ({ data: [ready] }));
    renderInProject(<DataExportScreen />);
    expect(await screen.findByText(/5\.0 MB · 150 tables · 42 files/)).toBeTruthy();
    expect(screen.getByText(/1 could not be included/)).toBeTruthy();
    expect(screen.getByText(/SHA-256 abab/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download zip' })).toBeTruthy();
  });

  it('starts an export and blocks a second while one is running', async () => {
    const user = userEvent.setup();
    let list: unknown[] = [];
    fake.on('GET', E, () => ({ data: list }));
    fake.on('POST', E, () => {
      list = [{ ...ready, status: 'queued', sizeBytes: null, sha256: null }];
      return list[0];
    });
    renderInProject(<DataExportScreen />);
    expect(await screen.findByText("You haven't exported yet.")).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Export everything' }));
    await waitFor(() => expect(fake.callsTo('POST', E)).toHaveLength(1));
    const busy = await screen.findByRole('button', { name: 'Export in progress' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Waiting to start')).toBeTruthy();
  });

  it('asks for the password when the sign-in is old, then starts the export', async () => {
    const user = userEvent.setup();
    fake.on('GET', E, () => ({ data: [] }));
    let first = true;
    fake.on('POST', E, () => {
      if (first) {
        first = false;
        return fakeProblem(403, 'auth.step_up_required');
      }
      return { ...ready, status: 'queued', sizeBytes: null, sha256: null };
    });
    fake.on('POST', '/v1/auth/login', () => ({ user: { id: 'usr_1' } }));
    renderInProject(<DataExportScreen />);
    await user.click(await screen.findByRole('button', { name: 'Export everything' }));
    await enterText(user, await screen.findByLabelText('Password'), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: 'Confirm and start export' }));
    await waitFor(() => expect(fake.callsTo('POST', E)).toHaveLength(2));
  });
});
