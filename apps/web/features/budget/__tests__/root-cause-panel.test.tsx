// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { RootCausePanel } = await import('../components/RootCausePanel');

const P = '/v1/orgs/{orgId}/projects/{projectId}';
const line = (id: string, costCodeId: string, code: string, revised: string, actual: string) => ({
  id,
  costCodeId,
  code,
  codeDescription: `Work ${code}`,
  description: '',
  original: revised,
  approvedChanges: '0.00',
  revised,
  committed: '0.00',
  actual,
  forecastToComplete: '0.00',
  isMargin: false,
});

beforeEach(() => {
  fake.reset();
  fake.on('GET', `${P}/budget`, () => ({
    id: 'bud_1',
    status: 'locked',
    lines: [
      line('bln_1', 'ccd_1', '03-100', '1000.00', '1500.00'),
      line('bln_2', 'ccd_2', '05-100', '1000.00', '900.00'),
    ],
  }));
  fake.on('GET', `${P}/cost-codes`, () => ({
    data: [
      { id: 'ccd_0', code: '03', description: 'Concrete', parentId: null, archived: false },
      { id: 'ccd_1', code: '03-100', description: 'Slab', parentId: 'ccd_0', archived: false },
      { id: 'ccd_2', code: '05-100', description: 'Steel', parentId: null, archived: false },
    ],
  }));
  fake.on('POST', `${P}/ai/budget-reviews`, () => ({
    runId: 'r1',
    reply: 'The slab ran over on extra concrete.',
    points: [],
    options: [],
    draftReason: null,
    notes: [],
    history: [],
    disclaimer: 'Nova can be wrong.',
  }));
});

describe('RootCausePanel', () => {
  it('totals the overage, then shows under budget lines when asked', async () => {
    const user = userEvent.setup();
    renderInProject(<RootCausePanel />);
    expect((await screen.findByTestId('rc-total')).textContent).toContain('500.00');
    expect(screen.queryByText(/Steel/)).toBeNull();
    await user.selectOptions(screen.getByLabelText('Budget status'), 'under');
    expect((await screen.findAllByText(/Work 05-100/)).length).toBeGreaterThan(0);
  });

  it('asks Nova about the selected division', async () => {
    const user = userEvent.setup();
    renderInProject(<RootCausePanel />);
    await user.click(await screen.findByRole('button', { name: /03 Concrete/ }));
    await user.click(screen.getByRole('button', { name: 'Explain why' }));
    expect(await screen.findByText(/extra concrete/)).toBeTruthy();
    await waitFor(() => expect(fake.callsTo('POST', `${P}/ai/budget-reviews`)).toHaveLength(1));
    expect(JSON.stringify(fake.callsTo('POST', `${P}/ai/budget-reviews`)[0]!.init.body)).toContain(
      'Concrete',
    );
  });
});
