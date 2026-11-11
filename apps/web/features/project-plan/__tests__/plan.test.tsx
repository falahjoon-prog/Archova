// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nav, renderInProject } from '@/test/render';
import type { PlanItem, ProjectPlan } from '../lib/labels';
import { createRoute, linkTone, progress } from '../lib/labels';
import { ProjectPlanScreen } from '../screens/ProjectPlanScreen';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);
vi.mock('@/features/projects', () => ({
  useProjectMembers: () => ({ data: { data: [{ userId: 'usr_1', name: 'Dana PM' }] } }),
}));

const item = (over: Partial<PlanItem>): PlanItem => ({
  id: 'pli_1',
  phaseId: 'ppx_1',
  number: '1.1',
  position: 1,
  title: 'Feasibility study',
  outcome: 'Acceptable per company guidelines',
  types: ['document'],
  dueDate: null,
  status: 'not_started',
  isOverdue: false,
  blockedBy: [],
  parties: [],
  references: [],
  links: [],
  requests: [],
  note: null,
  completedAt: null,
  holdCleared: false,
  holdClearedAt: null,
  holdNote: null,
  canClearHold: false,
  ...over,
});
const plan = (over: Partial<ProjectPlan> = {}): ProjectPlan => ({
  started: true,
  canManage: true,
  canClearHolds: true,
  phases: [
    {
      id: 'ppx_1',
      number: 1,
      title: 'Feasibility',
      doneCount: 0,
      items: [
        item({
          id: 'pli_1',
          title: 'Feasibility study',
          types: ['document', 'hold_point'],
          isOverdue: true,
          dueDate: '2026-11-01',
        }),
        item({
          id: 'pli_2',
          number: '1.2',
          position: 2,
          title: 'Site investigation report',
          blockedBy: [{ itemId: 'pli_1', number: '1.1', title: 'Feasibility study' }],
        }),
      ],
    },
  ],
  ...over,
});

const P = '/v1/orgs/{orgId}/projects/{projectId}/project-plan';
let current: ProjectPlan = plan();
beforeEach(() => {
  nav.search = '';
  fake.reset();
  current = plan();
  fake.on('GET', P, () => current);
  fake.on('GET', `${P}/insights`, () => ({
    overdue: [{ itemId: 'pli_1', number: '1.1', title: 'Feasibility study', daysLate: 6 }],
    atRisk: [],
    blockedByHold: [
      { holdItemId: 'pli_1', number: '1.1', title: 'Feasibility study', blockedCount: 1 },
    ],
    suggestedLinks: [],
  }));
  fake.on('GET', `${P}/items/{itemId}/link-options`, () => ({ data: [], restricted: false }));
});

describe('ProjectPlanScreen', () => {
  it('shows phases with numbered items, a waiting-on-hold note and what Nova flags', async () => {
    renderInProject(<ProjectPlanScreen />);
    const phase = await screen.findByRole('region', { name: 'Phase 1 Feasibility' });
    expect(within(phase).getByText('0 of 2 complete')).toBeTruthy();
    expect(within(phase).getByText('1.2')).toBeTruthy();
    expect(within(phase).getByText(/Waiting on hold point 1\.1/)).toBeTruthy();
    expect(within(phase).getByText(/Overdue · /)).toBeTruthy();
    const nova = await screen.findByRole('region', { name: 'Nova flags' });
    expect(within(nova).getByText(/is holding up 1 later item/)).toBeTruthy();
    expect(within(nova).getByText(/is 6 days late/)).toBeTruthy();
  });

  it('collapses a phase', async () => {
    const user = userEvent.setup();
    renderInProject(<ProjectPlanScreen />);
    const toggle = await screen.findByRole('button', { name: /^1 Feasibility$/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('offers to start the plan when there is none', async () => {
    current = plan({ started: false, phases: [] });
    renderInProject(<ProjectPlanScreen />);
    expect(
      await screen.findByRole('button', { name: 'Start from the standard plan' }),
    ).toBeTruthy();
  });

  it('opens an item in the panel and offers to clear a hold point', async () => {
    nav.search = 'item=pli_1';
    renderInProject(<ProjectPlanScreen />);
    const panel = await screen.findByRole('complementary', { name: /1\.1 Feasibility study/ });
    await waitFor(() =>
      expect(within(panel).getByRole('button', { name: 'Clear hold point' })).toBeTruthy(),
    );
    expect(within(panel).getByRole('link', { name: /Create new/ })).toBeTruthy();
  });

  it('clearing a hold point sends the note to the API', async () => {
    const user = userEvent.setup();
    nav.search = 'item=pli_1';
    fake.on('POST', `${P}/items/{itemId}/clear-hold`, () => current);
    renderInProject(<ProjectPlanScreen />);
    const panel = await screen.findByRole('complementary', { name: /1\.1/ });
    await user.type(within(panel).getByLabelText('Note (optional)'), 'Owner accepts');
    await user.click(within(panel).getByRole('button', { name: 'Clear hold point' }));
    await waitFor(() =>
      expect(fake.callsTo('POST', `${P}/items/{itemId}/clear-hold`)).toHaveLength(1),
    );
    expect(fake.callsTo('POST', `${P}/items/{itemId}/clear-hold`)[0]!.init.body).toEqual({
      note: 'Owner accepts',
    });
  });

  it('a blocked item says which hold point stops it', async () => {
    nav.search = 'item=pli_2';
    renderInProject(<ProjectPlanScreen />);
    const panel = await screen.findByRole('complementary', { name: /1\.2/ });
    expect(within(panel).getByRole('status').textContent).toMatch(
      /Hold point 1\.1 Feasibility study must be cleared/,
    );
  });
});

describe('labels', () => {
  it('shapes progress, link colours and create routes', () => {
    expect(progress(plan().phases[0]!)).toEqual({ done: 0, total: 2, pct: 0 });
    expect(linkTone('closed')).toBe('success');
    expect(linkTone('failed')).toBe('danger');
    expect(linkTone(null)).toBe('neutral');
    expect(createRoute('meeting', 'acme', 'prj_1')).toContain('/meetings');
    expect(createRoute('esign_envelope', 'acme', 'prj_1')).toBeNull();
  });
});
