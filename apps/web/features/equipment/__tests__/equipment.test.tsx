// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
const perm = vi.hoisted(() => ({ level: 'admin' }));
vi.mock('@/features/projects', () => ({
  useProjectPermissions: () => ({ data: { orgRole: null, toolLevels: { workforce: perm.level } } }),
}));
vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

const { EquipmentScreen } = await import('../screens/EquipmentScreen');

const P = '/v1/orgs/{orgId}/projects/{projectId}';
const machine = {
  id: 'eqp_1',
  name: '5t excavator',
  assetNumber: 'EX-1',
  type: 'Excavator',
  status: 'available',
  version: 1,
};
const booking = {
  id: 'eqb_1',
  equipmentId: 'eqp_1',
  startsOn: '2026-11-10',
  endsOn: '2026-11-12',
  bookedFor: 'Slab crew',
  note: null,
  status: 'active',
};

beforeEach(() => {
  fake.reset();
  perm.level = 'admin';
  fake.on('GET', `${P}/equipment`, () => ({ data: [machine] }));
  fake.on('GET', `${P}/equipment-bookings`, () => ({ data: [booking] }));
  fake.on('GET', `${P}/equipment/{equipmentId}/logs`, () => ({ data: [] }));
});

describe('EquipmentScreen', () => {
  it('lists machines and their bookings', async () => {
    renderInProject(<EquipmentScreen />);
    expect(await screen.findByText('EX-1')).toBeTruthy();
    expect(await screen.findByText('Slab crew')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Cancel booking of 5t excavator/ })).toBeTruthy();
  });

  it('refuses hours that are not in quarter hours and sends valid ones', async () => {
    const posts: unknown[] = [];
    fake.on('POST', `${P}/equipment/{equipmentId}/logs`, (init: { body?: unknown }) => {
      posts.push(init.body);
      return {
        id: 'eql_1',
        equipmentId: 'eqp_1',
        date: '2026-11-05',
        hours: '7.50',
        operator: null,
        notes: null,
      };
    });
    renderInProject(<EquipmentScreen />);
    await screen.findByText('EX-1');
    const user = userEvent.setup();
    const form =
      screen.getByRole('heading', { name: 'Log hours' }).closest('section') ?? document.body;
    const machineSelect = form.querySelector('select') as HTMLSelectElement;
    await user.selectOptions(machineSelect, 'eqp_1');
    await enterText(user, screen.getByLabelText(/^Hours/), '7.3');
    await user.click(screen.getByRole('button', { name: 'Log hours' }));
    expect(await screen.findByText(/quarter hours/)).toBeTruthy();
    expect(posts).toHaveLength(0);
    await user.clear(screen.getByLabelText(/^Hours/));
    await enterText(user, screen.getByLabelText(/^Hours/), '7.5');
    await user.click(screen.getByRole('button', { name: 'Log hours' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ hours: '7.5' });
  });

  it('shows read-only status and no manager forms to a standard member', async () => {
    perm.level = 'standard';
    renderInProject(<EquipmentScreen />);
    expect(await screen.findByText('EX-1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add machine' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Book machine' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Log hours' })).toBeTruthy();
  });
});
