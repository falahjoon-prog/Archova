// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as OrgProvider from '@/shared/providers/CurrentOrgProvider';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, renderInProject, testOrg } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
const org = vi.hoisted(() => ({ role: 'admin' }));
vi.mock('@/shared/providers/CurrentOrgProvider', async (orig) => ({
  ...(await orig<typeof OrgProvider>()),
  useCurrentOrg: () => ({
    orgId: 'org_test',
    orgSlug: 'acme',
    orgName: 'Acme',
    kind: 'member',
    user: testOrg.user,
    role: org.role,
  }),
}));

const { NovaSettingsScreen } = await import('../screens/NovaSettingsScreen');

const S = '/v1/orgs/{orgId}/ai/settings';
const U = '/v1/orgs/{orgId}/ai/usage';
const base = {
  aiEnabled: true,
  featuresEnabled: null,
  monthlyCreditCap: null,
  externalAiEnabled: false,
  retentionDays: 30,
  version: 4,
};

beforeEach(() => {
  fake.reset();
  org.role = 'admin';
  fake.on('GET', S, () => base);
  fake.on('GET', U, () => ({
    periodStart: '2026-11-01',
    timezone: 'Australia/Sydney',
    allowance: 1000,
    granted: 0,
    used: 120.5,
    remaining: 879.5,
    byFeature: [{ feature: 'ask', credits: 120.5, runs: 40 }],
  }));
});

describe('NovaSettingsScreen', () => {
  it('shows this month’s credits by feature', async () => {
    renderInProject(<NovaSettingsScreen />);
    expect(await screen.findByText(/879.5 of 1,000 left/)).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Credits by feature' });
    expect(within(table).getByText('Ask Nova')).toBeTruthy();
  });

  it('saves a cap, a feature switched off, and sends If-Match; all features on sends null', async () => {
    const user = userEvent.setup();
    fake.on('PATCH', S, () => ({ ...base, version: 5 }));
    renderInProject(<NovaSettingsScreen />);
    await enterText(user, await screen.findByLabelText('Monthly credit cap'), '500');
    await user.click(screen.getByRole('checkbox', { name: 'Diary summaries' }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(fake.callsTo('PATCH', S)).toHaveLength(1));
    const call = fake.callsTo('PATCH', S)[0]!;
    expect(call.init.params!.header).toMatchObject({ 'If-Match': '"4"' });
    const body = call.init.body as { featuresEnabled: string[]; monthlyCreditCap: number };
    expect(body.monthlyCreditCap).toBe(500);
    expect(body.featuresEnabled).not.toContain('diary_summary');
    expect(body.featuresEnabled).toContain('ask');
    expect(await screen.findByText('Saved.')).toBeTruthy();
  });

  it('blocks a retention outside 0 to 90', async () => {
    const user = userEvent.setup();
    renderInProject(<NovaSettingsScreen />);
    const days = await screen.findByLabelText(/Keep what people ask Nova for/);
    await user.clear(days);
    await enterText(user, days, '120');
    expect(screen.getByText('Enter a whole number from 0 to 90.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('is read-only for a member', async () => {
    org.role = 'member';
    renderInProject(<NovaSettingsScreen />);
    expect(await screen.findByText(/Only owners and admins can change/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull();
  });
});
