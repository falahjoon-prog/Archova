// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationMock, renderInProject } from '@/test/render';

vi.mock('next/navigation', () => navigationMock);
const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', async () => {
  const { createQueries } = await import('@archova/query');
  return { ...fake.module, queries: createQueries(fake.module.api as never) };
});

const { InsightsCard } = await import('../components/InsightsCard');
const P = '/v1/orgs/{orgId}/projects/{projectId}';
const NOTES = {
  projectId: 'prj_1',
  projectName: 'Alpha Tower',
  insights: [
    {
      id: 'budget',
      kind: 'budget',
      severity: 'high',
      title: 'Forecast is $182,400 over budget',
      detail: 'The forecast final cost is $4,382,400.',
      facts: ['Forecast over budget by: $182,400'],
    },
    {
      id: 'rfis',
      kind: 'rfis',
      severity: 'low',
      title: '1 RFI past their due date',
      detail: '9 RFIs are open on this project; 1 of them is overdue.',
      facts: ['Overdue RFIs: 1'],
    },
  ],
};

describe('InsightsCard', () => {
  beforeEach(() => fake.reset());

  it('lists the notes worst first with their severity', async () => {
    fake.on('GET', `${P}/insights`, () => NOTES);
    renderInProject(<InsightsCard projectId="prj_1" />);
    expect(await screen.findByText('Forecast is $182,400 over budget')).toBeTruthy();
    expect(screen.getByText('High')).toBeTruthy();
    expect(screen.getByText('Low')).toBeTruthy();
  });

  it('says so when nothing needs attention, and offers no chat', async () => {
    fake.on('GET', `${P}/insights`, () => ({ ...NOTES, insights: [] }));
    renderInProject(<InsightsCard projectId="prj_1" />);
    expect(await screen.findByText(/Nothing needs attention right now/)).toBeTruthy();
    expect(screen.queryByLabelText('Ask Nova')).toBeNull();
  });

  it('asks Nova about the picked note, sends the earlier turns, and shows options as suggestions only', async () => {
    fake.on('GET', `${P}/insights`, () => NOTES);
    const discuss = vi.fn(
      (req: { body: { question: string; insightId?: string; history: unknown[] } }) => ({
        runId: 'run_1',
        grounded: true,
        answer: `Answer to ${req.body.question}`,
        suggestions: ['Consider reviewing the cost codes.'],
        reviewRequired: true,
      }),
    );
    fake.on('POST', `${P}/insights/discuss`, discuss as never);
    renderInProject(<InsightsCard projectId="prj_1" />);
    const row = (await screen.findByText('Forecast is $182,400 over budget')).closest('li')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Ask Nova about this' }));
    expect(screen.getByText('Asking about: Forecast is $182,400 over budget')).toBeTruthy();

    await userEvent.type(screen.getByLabelText('Ask Nova'), 'Why?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText('Answer to Why?')).toBeTruthy();
    expect(screen.getByText('Consider reviewing the cost codes.')).toBeTruthy();
    expect(screen.getByText('Nova only suggests. Nothing has been changed.')).toBeTruthy();
    expect(discuss.mock.calls[0]![0].body).toMatchObject({ insightId: 'budget', history: [] });

    await userEvent.type(screen.getByLabelText('Ask Nova'), 'And then?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await screen.findByText('Answer to And then?');
    expect(discuss.mock.calls[1]![0].body.history).toEqual([
      { role: 'user', text: 'Why?' },
      { role: 'nova', text: 'Answer to Why?' },
    ]);
  });

  it('shows a retry message when Nova fails', async () => {
    fake.on('GET', `${P}/insights`, () => NOTES);
    fake.on('POST', `${P}/insights/discuss`, () => {
      throw new Error('boom');
    });
    renderInProject(<InsightsCard projectId="prj_1" />);
    await screen.findByText('Forecast is $182,400 over budget');
    await userEvent.click(screen.getByRole('button', { name: 'What should I look at first?' }));
    expect(await screen.findByText(/Nova couldn't answer this/)).toBeTruthy();
  });
});
