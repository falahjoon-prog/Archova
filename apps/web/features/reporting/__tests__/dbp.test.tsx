// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', async () => {
  const { createQueries } = await import('@archova/query');
  return { ...fake.module, queries: createQueries(fake.module.api as never) };
});

const { DbpInsightsScreen } = await import('../screens/DbpInsightsScreen');

const counts = (over: Record<string, number> = {}) => ({
  serious_defect: 0,
  potential_serious_defect: 0,
  low_risk: 0,
  unclassified: 0,
  ...over,
});

beforeEach(() => fake.reset());

describe('DbpInsightsScreen', () => {
  it('shows each building element with its pass rate, and the classification totals', async () => {
    fake.on('GET', '/v1/orgs/{orgId}/dbp-insights', () => ({
      categories: [
        {
          category: 'fire_safety',
          itemsPassing: { pass: 8, fail: 2, rate: 80 },
          lateInspections: 1,
          lateObservations: 0,
          classifications: counts({ serious_defect: 2, low_risk: 1 }),
        },
        {
          category: 'waterproofing',
          itemsPassing: { pass: 0, fail: 0, rate: null },
          lateInspections: 0,
          lateObservations: 0,
          classifications: counts(),
        },
      ],
      classificationTotals: counts({ serious_defect: 2, low_risk: 1 }),
      passRateTrend: [{ month: '2026-10', pass: 8, fail: 2, rate: 80 }],
      conditions: [{ condition: 'workmanship', count: 3 }],
      projects: [
        {
          id: 'prj_1',
          name: 'Harbour Tower',
          restricted: false,
          classifications: counts({ serious_defect: 2, low_risk: 1 }),
          lateInspections: 1,
          lateObservations: 0,
        },
      ],
      restrictedProjects: 1,
      truncated: false,
    }));
    renderInProject(<DbpInsightsScreen />);
    expect(await screen.findByRole('heading', { name: 'Fire safety systems' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Waterproofing systems' })).toBeTruthy();
    expect(screen.getByText('80%')).toBeTruthy();
    expect(screen.getByText('No data')).toBeTruthy();
    expect(screen.getByText('Workmanship')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Harbour Tower' })).toBeTruthy();
    expect(screen.getByText(/1 project is not counted/)).toBeTruthy();
  });

  it('says so when there is nothing to show', async () => {
    fake.on('GET', '/v1/orgs/{orgId}/dbp-insights', () => ({
      categories: [],
      classificationTotals: counts(),
      passRateTrend: [],
      conditions: [],
      projects: [],
      restrictedProjects: 0,
      truncated: false,
    }));
    renderInProject(<DbpInsightsScreen />);
    expect(await screen.findByText('Nothing to show yet')).toBeTruthy();
  });
});
