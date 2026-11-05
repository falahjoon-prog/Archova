// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, renderInProject } from '@/test/render';
import type { RetentionRelease } from '../data/api';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

const { RetentionReleasePanel } = await import('../components/RetentionReleasePanel');

const P = '/v1/orgs/{orgId}/projects/{projectId}/contracts/{contractId}/retention-release';
const release = (over: Partial<RetentionRelease> = {}): RetentionRelease => ({
  contractId: 'cnt_1',
  terms: { practicalCompletionOn: '2026-10-01', defectsPeriodDays: 365, firstReleasePct: '50.00' },
  retentionHeld: '2000.00',
  stages: [
    {
      stage: 'practical_completion',
      dueOn: '2026-10-01',
      entitled: '1000.00',
      released: '0.00',
      remaining: '1000.00',
      status: 'due',
    },
    {
      stage: 'defects_end',
      dueOn: '2027-10-01',
      entitled: '1000.00',
      released: '0.00',
      remaining: '1000.00',
      status: 'upcoming',
    },
  ],
  releases: [],
  ...over,
});

beforeEach(() => fake.reset());

describe('RetentionReleasePanel', () => {
  it('shows a payee the stages and offers no forms', async () => {
    fake.on('GET', P, () => release());
    renderInProject(<RetentionReleasePanel contractId="cnt_1" canManage={false} />);
    expect(await screen.findByText('At practical completion')).toBeTruthy();
    expect(screen.getByText('Due for release')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record release' })).toBeNull();
  });

  it('stops a release above the stage balance, then sends a valid one', async () => {
    fake.on('GET', P, () => release());
    fake.on('POST', `${P}/releases`, () => release());
    const user = userEvent.setup();
    renderInProject(<RetentionReleasePanel contractId="cnt_1" canManage />);
    await screen.findByText('Retention held');
    await enterText(user, screen.getByLabelText('Amount'), '1500.00');
    await enterText(user, screen.getByLabelText('Date released'), '2026-11-01');
    await enterText(user, screen.getByLabelText('Reference'), 'R-1');
    await user.click(screen.getByRole('button', { name: 'Record release' }));
    expect(await screen.findByText(/more than the .* still to release/)).toBeTruthy();
    expect(fake.callsTo('POST', `${P}/releases`)).toHaveLength(0);
    await user.clear(screen.getByLabelText('Amount'));
    await enterText(user, screen.getByLabelText('Amount'), '1000.00');
    await user.click(screen.getByRole('button', { name: 'Record release' }));
    await waitFor(() => expect(fake.callsTo('POST', `${P}/releases`)).toHaveLength(1));
    expect(fake.callsTo('POST', `${P}/releases`)[0]!.init.body).toEqual({
      stage: 'practical_completion',
      amount: '1000.00',
      releasedOn: '2026-11-01',
      reference: 'R-1',
    });
  });

  it('can record a release without taking it out of the trust account', async () => {
    fake.on('GET', P, () => release());
    fake.on('POST', `${P}/releases`, () => release());
    const user = userEvent.setup();
    renderInProject(<RetentionReleasePanel contractId="cnt_1" canManage />);
    await screen.findByText('Retention held');
    await enterText(user, screen.getByLabelText('Amount'), '500.00');
    await enterText(user, screen.getByLabelText('Date released'), '2026-11-01');
    await enterText(user, screen.getByLabelText('Reference'), 'R-2');
    await user.click(screen.getByLabelText(/Don.t take this out of the trust account/));
    await user.click(screen.getByRole('button', { name: 'Record release' }));
    await waitFor(() => expect(fake.callsTo('POST', `${P}/releases`)).toHaveLength(1));
    expect(fake.callsTo('POST', `${P}/releases`)[0]!.init.body).toMatchObject({ fromTrust: false });
  });

  it('saves the release terms', async () => {
    fake.on('GET', P, () => release());
    fake.on('PUT', P, () => release());
    const user = userEvent.setup();
    renderInProject(<RetentionReleasePanel contractId="cnt_1" canManage />);
    await screen.findByText('Retention held');
    await user.clear(screen.getByLabelText('Defects period (days)'));
    await enterText(user, screen.getByLabelText('Defects period (days)'), '180');
    await user.click(screen.getByRole('button', { name: 'Save release terms' }));
    await waitFor(() => expect(fake.callsTo('PUT', P)).toHaveLength(1));
    expect(fake.callsTo('PUT', P)[0]!.init.body).toEqual({
      practicalCompletionOn: '2026-10-01',
      defectsPeriodDays: 180,
      firstReleasePct: '50.00',
    });
  });
});
