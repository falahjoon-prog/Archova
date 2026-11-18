// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { LaborProductivityPanel } = await import('../components/LaborProductivityPanel');

const P = '/v1/orgs/{orgId}/projects/{projectId}';
const row = (over: Record<string, unknown> = {}) => ({
  costCodeId: 'ccd_1',
  code: '03-100',
  description: 'Slab',
  divisionId: 'ccd_0',
  parentId: 'ccd_0',
  uom: 'm2',
  budgetedHours: 100,
  timesheetHours: 80,
  pctHoursUsed: 0.8,
  pctComplete: 0.5,
  earnedHours: 50,
  budgetedQuantity: 500,
  quantityComplete: 250,
  budgetedRate: 5,
  actualRate: 3.13,
  flagged: true,
  ...over,
});

beforeEach(() => {
  fake.reset();
  fake.on('GET', `${P}/reports/labor-productivity`, () => ({
    rows: [
      row(),
      row({
        costCodeId: 'ccd_2',
        code: '03-200',
        description: 'Walls',
        actualRate: 6,
        flagged: false,
      }),
    ],
    totals: {
      budgetedHours: 200,
      timesheetHours: 160,
      earnedHours: 100,
      pctHoursUsed: 0.8,
      efficiency: 0.63,
      flaggedRows: 1,
    },
    unallocatedHours: 4,
    codes: [
      { id: 'ccd_0', code: '03', description: 'Concrete', parentId: null },
      { id: 'ccd_1', code: '03-100', description: 'Slab', parentId: 'ccd_0' },
      { id: 'ccd_2', code: '03-200', description: 'Walls', parentId: 'ccd_0' },
    ],
  }));
});

describe('LaborProductivityPanel', () => {
  it('shows the columns, flags the slow row and summarises the hours', async () => {
    renderInProject(<LaborProductivityPanel canManage />);
    expect(await screen.findByText('Slab')).toBeTruthy();
    expect(screen.getAllByText('Below plan')).toHaveLength(1);
    expect(screen.getAllByText('50.0%').length).toBeGreaterThan(0);
    expect(screen.getByText(/1 below plan/)).toBeTruthy();
    expect(screen.getByText(/4 hours have no cost code/)).toBeTruthy();
  });

  it('asks for the report again when a division is chosen', async () => {
    const user = userEvent.setup();
    renderInProject(<LaborProductivityPanel canManage={false} />);
    await screen.findByText('Slab');
    await user.selectOptions(screen.getByLabelText('Division'), 'ccd_0');
    await waitFor(() =>
      expect(
        fake
          .callsTo('GET', `${P}/reports/labor-productivity`)
          .some((c) => JSON.stringify(c.init).includes('ccd_0')),
      ).toBe(true),
    );
    expect(screen.queryByRole('button', { name: /Edit plan/ })).toBeNull();
  });

  it('validates then saves a plan', async () => {
    fake.on('PUT', `${P}/cost-codes/{costCodeId}/production`, () => ({}));
    const user = userEvent.setup();
    renderInProject(<LaborProductivityPanel canManage />);
    await user.click(await screen.findByRole('button', { name: 'Edit plan 03-100' }));
    await user.clear(screen.getByLabelText(/^Budgeted hours/));
    await user.click(screen.getByRole('button', { name: 'Save plan' }));
    expect(await screen.findByText(/Enter the budgeted hours/)).toBeTruthy();
    await enterText(user, screen.getByLabelText(/^Budgeted hours/), '120');
    await user.click(screen.getByRole('button', { name: 'Save plan' }));
    await waitFor(() =>
      expect(fake.callsTo('PUT', `${P}/cost-codes/{costCodeId}/production`)).toHaveLength(1),
    );
    expect(fake.callsTo('PUT', `${P}/cost-codes/{costCodeId}/production`)[0]!.init.body).toEqual({
      uom: 'm2',
      budgetedHours: 120,
      budgetedQuantity: 500,
    });
  });

  it('logs quantity for a day and refuses a correction without a note', async () => {
    fake.on('GET', `${P}/cost-codes/{costCodeId}/production/log`, () => ({
      data: [
        {
          id: 'pgl_1',
          loggedOn: '2026-10-28',
          quantity: 40,
          note: null,
          createdAt: '2026-10-28T01:00:00Z',
        },
      ],
    }));
    fake.on('POST', `${P}/cost-codes/{costCodeId}/production/log`, () => ({
      entry: {
        id: 'pgl_2',
        loggedOn: '2026-10-29',
        quantity: 12.5,
        note: null,
        createdAt: '2026-10-29T01:00:00Z',
      },
      quantityComplete: 262.5,
    }));
    const user = userEvent.setup();
    renderInProject(<LaborProductivityPanel canManage={false} />);
    await user.click(await screen.findByRole('button', { name: 'Log quantity 03-100' }));
    expect(await screen.findByText(/40/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Log quantity' }));
    expect(await screen.findByText(/Enter the quantity put in place/)).toBeTruthy();
    await enterText(user, screen.getByLabelText(/^Quantity put in place/), '-5');
    await user.click(screen.getByRole('button', { name: 'Log quantity' }));
    expect(await screen.findByText(/Say why the quantity is being taken off/)).toBeTruthy();
    expect(fake.callsTo('POST', `${P}/cost-codes/{costCodeId}/production/log`)).toHaveLength(0);
    await user.clear(screen.getByLabelText(/^Quantity put in place/));
    await enterText(user, screen.getByLabelText(/^Quantity put in place/), '12.5');
    await user.click(screen.getByRole('button', { name: 'Log quantity' }));
    await waitFor(() =>
      expect(fake.callsTo('POST', `${P}/cost-codes/{costCodeId}/production/log`)).toHaveLength(1),
    );
    expect(
      fake.callsTo('POST', `${P}/cost-codes/{costCodeId}/production/log`)[0]!.init.body,
    ).toMatchObject({ quantity: 12.5 });
  });

  it('exports the report as CSV', async () => {
    fake.on('GET', `${P}/reports/labor-productivity/export`, () => ({
      filename: 'labor-productivity.csv',
      csv: 'Cost code\r\n03-100\r\n',
      count: 2,
    }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const user = userEvent.setup();
    renderInProject(<LaborProductivityPanel canManage={false} />);
    await screen.findByText('Slab');
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  });

  it('asks Nova about a slow code and keeps the conversation going', async () => {
    const turn = (role: string, text: string) => ({ role, text });
    fake.on('POST', `${P}/ai/labor-productivity`, (init) => {
      const asking = Boolean((init.body as { question?: string } | undefined)?.question);
      return {
        runId: 'air_1',
        reply: asking
          ? 'Weather could explain some of it.'
          : 'This code is 37.5% under its planned rate.',
        causes: asking
          ? []
          : [
              {
                title: 'Rework or waiting time',
                why: 'Hours outrun the work.',
                check: 'Ask the supervisor.',
                likelihood: 'likely',
              },
            ],
        questions: ['Was there any rework?'],
        notes: [],
        history: asking
          ? [
              turn('nova', 'This code is 37.5% under its planned rate.'),
              turn('user', 'Weather?'),
              turn('nova', 'Weather could explain some of it.'),
            ]
          : [turn('nova', 'This code is 37.5% under its planned rate.')],
        disclaimer: 'Nova is an AI assistant.',
      };
    });
    const user = userEvent.setup();
    renderInProject(<LaborProductivityPanel canManage={false} />);
    // Only the slow code offers Nova.
    expect(await screen.findAllByRole('button', { name: /^Ask Nova/ })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Ask Nova 03-100' }));
    expect(await screen.findByText('Rework or waiting time')).toBeTruthy();
    expect(screen.getByText('Likely')).toBeTruthy();
    await enterText(user, screen.getByLabelText('Ask Nova a follow-up'), 'Weather?');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Weather could explain some of it.')).toBeTruthy();
    const calls = fake.callsTo('POST', `${P}/ai/labor-productivity`);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.init.body).toMatchObject({ costCodeId: 'ccd_1', question: 'Weather?' });
    expect((calls[1]!.init.body as { history: unknown[] }).history).toHaveLength(1);
  });
});
