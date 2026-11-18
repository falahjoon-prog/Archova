// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, renderInProject } from '@/test/render';

import { todayIn } from '@/shared/lib/format';
import { instantOf } from '../lib/board';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
const perm = vi.hoisted(() => ({ level: 'admin' }));
vi.mock('@/features/projects', () => ({
  useProjectPermissions: () => ({ data: { orgRole: null, toolLevels: { workforce: perm.level } } }),
}));
vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

const { DeliveriesScreen } = await import('../screens/DeliveriesScreen');

const P = '/v1/orgs/{orgId}/projects/{projectId}';
const dock = {
  id: 'lgr_dock',
  name: 'Gate 2 dock',
  kind: 'dock',
  capacity: 1,
  active: true,
  note: null,
  version: 1,
};
// Midday today in the test project's zone, so the delivery is on the day the board opens at whatever time this runs.
const TZ = 'Australia/Sydney';
const start = new Date(instantOf(todayIn(TZ), '12:00', TZ));
const end = new Date(instantOf(todayIn(TZ), '13:00', TZ));
const delivery = {
  id: 'dlv_1',
  number: 1,
  title: 'Level 3 beams',
  supplierName: 'Acme Steel',
  supplierCompanyId: null,
  supplierContact: null,
  supplierEmail: 'dispatch@acme.test',
  supplierPhone: null,
  items: [],
  windowStart: start.toISOString(),
  windowEnd: end.toISOString(),
  zoneId: 'lgr_dock',
  needsLift: false,
  liftResourceId: null,
  liftStart: null,
  liftEnd: null,
  vehicle: null,
  accessNotes: null,
  status: 'scheduled',
  arrivedAt: null,
  unloadedAt: null,
  statusReason: null,
  commitmentId: null,
  commitmentLabel: null,
  version: 1,
};

beforeEach(() => {
  fake.reset();
  perm.level = 'admin';
  fake.on('GET', `${P}/logistics/resources`, () => ({ data: [dock] }));
  fake.on('GET', `${P}/deliveries`, () => ({ data: [delivery] }));
  fake.on('GET', `${P}/commitments`, () => ({ data: [] }));
  fake.on('GET', `${P}/delivery-insights`, () => ({
    asOf: new Date().toISOString(),
    today: '2026-11-09',
    counts: { today: 1, arrivedToday: 0, late: 1, clashes: 0, noPlan: 0 },
    flags: [
      {
        deliveryId: 'dlv_1',
        kind: 'late',
        severity: 'medium',
        message: '#1 Acme Steel is 20 min past the start of its window.',
        relatedDeliveryIds: [],
      },
    ],
  }));
});

describe('DeliveriesScreen', () => {
  it('shows Nova’s flags and answers questions from the board', async () => {
    renderInProject(<DeliveriesScreen />);
    expect(await screen.findByText(/20 min past the start/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Draft chase note' })).toBeTruthy();
    const user = userEvent.setup();
    await enterText(
      user,
      screen.getByLabelText(/Ask Nova about the deliveries/),
      'who is bringing steel',
    );
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    const answer = await screen.findByRole('status');
    expect(answer.textContent).toContain('Acme Steel');
  });

  it('logs a truck arriving from the list', async () => {
    const posts: unknown[] = [];
    fake.on('POST', `${P}/deliveries/{deliveryId}/check-in`, (init: { body?: unknown }) => {
      posts.push(init.body);
      return { ...delivery, status: 'arrived' };
    });
    renderInProject(<DeliveriesScreen />);
    const user = userEvent.setup();
    const arrived = await screen.findByRole('button', { name: 'Arrived' });
    await user.click(arrived);
    await waitFor(() => expect(posts).toEqual([{ event: 'arrived' }]));
  });

  it('lets site staff check in but not book', async () => {
    perm.level = 'standard';
    renderInProject(<DeliveriesScreen />);
    await screen.findByRole('button', { name: 'Arrived' });
    expect(screen.queryByRole('button', { name: 'Book a delivery' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Draft chase note' })).toBeNull();
  });
});
