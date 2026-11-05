// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { PermissionTemplatesScreen } = await import('../screens/PermissionTemplatesScreen');

const T = '/v1/orgs/{orgId}/permission-templates';
const tpl = (over = {}) => ({
  id: 'ptp_1',
  name: 'Site Manager',
  description: 'Runs the site.',
  toolLevels: { diary: 'admin', rfis: 'standard', budget: 'none' },
  granular: [],
  companyScopedTools: [],
  isSeeded: true,
  version: 1,
  ...over,
});

beforeEach(() => fake.reset());

describe('PermissionTemplatesScreen', () => {
  it('shows each template as a column with its level per tool', async () => {
    fake.on('GET', T, () => ({
      data: [tpl(), tpl({ id: 'ptp_2', name: 'Client', toolLevels: { diary: 'read' } })],
    }));
    renderInProject(<PermissionTemplatesScreen />);
    const table = await screen.findByRole('table', { name: 'Access by tool' });
    expect(within(table).getByText('Site Manager')).toBeTruthy();
    expect(within(table).getByText('Client')).toBeTruthy();
    const diary = within(table).getByText('Site diary').closest('tr')!;
    expect(within(diary).getByText('Admin')).toBeTruthy();
    expect(within(diary).getByText('View')).toBeTruthy();
  });

  it('describes granular rights and company-scoped tools', async () => {
    fake.on('GET', T, () => ({
      data: [
        tpl({
          name: 'Superintendent',
          granular: ['financials.variations.approve'],
          companyScopedTools: ['rfis'],
        }),
      ],
    }));
    renderInProject(<PermissionTemplatesScreen />);
    expect(await screen.findByText(/Can also: Approve variations/)).toBeTruthy();
    expect(screen.getByText(/own company's records in: RFIs/)).toBeTruthy();
  });
});
