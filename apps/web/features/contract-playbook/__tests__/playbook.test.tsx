// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, renderInProject, testOrg } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
const org = vi.hoisted(() => ({ role: 'admin' }));
vi.mock('@/shared/providers/CurrentOrgProvider', async (orig) => ({
  ...(await orig<typeof import('@/shared/providers/CurrentOrgProvider')>()),
  useCurrentOrg: () => ({
    orgId: 'org_test',
    orgSlug: 'acme',
    orgName: 'Acme',
    kind: 'member',
    user: testOrg.user,
    role: org.role,
  }),
}));

const { ContractPlaybookScreen } = await import('../screens/ContractPlaybookScreen');

const PB = '/v1/orgs/{orgId}/ai/contract-playbooks/{contractType}';
const topic = {
  key: 'ld_cap',
  topic: 'Liquidated damages cap',
  position: 'Cap at 10% of the contract sum',
  threshold: '10%',
  severity: 'high' as const,
  fallback: null,
};

beforeEach(() => {
  fake.reset();
  org.role = 'admin';
  fake.on('GET', PB, () => ({ contractType: 'subcontract', topics: [topic] }));
});

describe('ContractPlaybookScreen', () => {
  it('lists the saved topics for the chosen contract type', async () => {
    renderInProject(<ContractPlaybookScreen />);
    expect(await screen.findByDisplayValue('Liquidated damages cap')).toBeTruthy();
    expect(fake.callsTo('GET', PB)[0]!.init).toMatchObject({
      params: { path: { orgId: 'org_test', contractType: 'subcontract' } },
    });
  });

  it('is for admins only and makes no call for anyone else', () => {
    org.role = 'member';
    renderInProject(<ContractPlaybookScreen />);
    expect(screen.getByText('Admins only')).toBeTruthy();
    expect(fake.callsTo('GET', PB)).toHaveLength(0);
  });

  it('adds a topic with approved wording and saves the whole list with a key made from its name', async () => {
    const user = userEvent.setup();
    fake.on('PUT', PB, (init) => ({
      contractType: 'subcontract',
      topics: (init.body as { topics: unknown[] }).topics,
    }));
    renderInProject(<ContractPlaybookScreen />);
    await screen.findByDisplayValue('Liquidated damages cap');
    await user.click(screen.getByRole('button', { name: 'Add topic' }));
    const names = screen.getAllByLabelText('Topic');
    await enterText(user, names[1]!, 'Security release');
    await enterText(
      user,
      screen.getAllByLabelText('Our position')[1]!,
      'Half at practical completion',
    );
    await user.click(screen.getAllByRole('button', { name: 'Add approved wording' })[1]!);
    await enterText(user, screen.getByLabelText('Wording title'), 'Security release');
    await enterText(user, screen.getByLabelText('Approved wording'), 'Half is released at PC.');
    await enterText(user, screen.getByLabelText('Approved by'), 'Priya Shah');
    await enterText(user, screen.getByLabelText('Approved on'), '2026-08-01');
    await user.click(screen.getByRole('button', { name: 'Save playbook' }));
    await waitFor(() => expect(fake.callsTo('PUT', PB)).toHaveLength(1));
    const sent = (
      fake.callsTo('PUT', PB)[0]!.init.body as { topics: Array<Record<string, unknown>> }
    ).topics;
    expect(sent.map((t) => t.key)).toEqual(['ld_cap', 'security_release']);
    expect(sent[1]).toMatchObject({
      threshold: null,
      fallback: { approvedBy: 'Priya Shah', approvedOn: '2026-08-01', reviewBy: null },
    });
    expect(await screen.findByText('Playbook saved')).toBeTruthy();
  });

  it('does not save a topic whose approved wording is incomplete', async () => {
    const user = userEvent.setup();
    renderInProject(<ContractPlaybookScreen />);
    await screen.findByDisplayValue('Liquidated damages cap');
    await user.click(screen.getByRole('button', { name: 'Add approved wording' }));
    await user.click(screen.getByRole('button', { name: 'Save playbook' }));
    expect(await screen.findByText('Add a title and the approved wording.')).toBeTruthy();
    expect(fake.callsTo('PUT', PB)).toHaveLength(0);
  });

  it('removes and reorders topics', async () => {
    const user = userEvent.setup();
    fake.on('GET', PB, () => ({
      contractType: 'subcontract',
      topics: [topic, { ...topic, key: 'security', topic: 'Security release' }],
    }));
    fake.on('PUT', PB, (init) => ({
      contractType: 'subcontract',
      topics: (init.body as { topics: unknown[] }).topics,
    }));
    renderInProject(<ContractPlaybookScreen />);
    await screen.findByDisplayValue('Security release');
    await user.click(screen.getByRole('button', { name: 'Move Security release up' }));
    await user.click(screen.getByRole('button', { name: 'Remove Liquidated damages cap' }));
    await user.click(screen.getByRole('button', { name: 'Save playbook' }));
    await waitFor(() => expect(fake.callsTo('PUT', PB)).toHaveLength(1));
    const sent = (fake.callsTo('PUT', PB)[0]!.init.body as { topics: Array<{ key: string }> })
      .topics;
    expect(sent.map((t) => t.key)).toEqual(['security']);
  });
});
