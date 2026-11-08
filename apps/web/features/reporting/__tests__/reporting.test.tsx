// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', async () => {
  const { createQueries } = await import('@archova/query');
  return { ...fake.module, queries: createQueries(fake.module.api as never) };
});

const { PortfolioScreen } = await import('../screens/PortfolioScreen');
const { ReportsScreen } = await import('../screens/ReportsScreen');
const { ReadinessScreen } = await import('../screens/ReadinessScreen');
const { toCsv, orderColumns } = await import('../lib/types');

const tool = (open: number, overdue: number, restricted = false) => ({
  restricted,
  open,
  overdue,
});
const project = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  number: null,
  status: 'active',
  phase: null,
  siteLocation: null,
  rfis: tool(0, 0),
  defects: tool(0, 0),
  submittals: tool(0, 0),
  claims: tool(0, 0),
  variations: tool(0, 0),
  incidents: tool(0, 0),
  programme: { ...tool(0, 0), notStarted: 0, completed: 0, lateDays: 0 },
  budget: {
    restricted: true,
    hasBudget: false,
    revised: '0.00',
    forecastFinal: '0.00',
    spent: '0.00',
    variance: '0.00',
    overBudgetCodes: 0,
    monthly: [],
  },
  attention: 0,
  ...over,
});

const PORTFOLIO = '/v1/orgs/{orgId}/portfolio';
const REPORTS = '/v1/orgs/{orgId}/reports';
const PREVIEW = '/v1/orgs/{orgId}/reports/preview';
const PROJECTS = '/v1/orgs/{orgId}/projects';

beforeEach(() => fake.reset());

describe('PortfolioScreen', () => {
  it('shows company totals and a row per project, with no access called out', async () => {
    fake.on('GET', PORTFOLIO, () => ({
      totals: {
        projects: 2,
        rfisOpen: 5,
        rfisOverdue: 2,
        defectsOpen: 1,
        defectsOverdue: 0,
        submittalsOpen: 0,
        submittalsOverdue: 0,
        claimsOpen: 0,
        claimsOverdue: 0,
        variationsOpen: 0,
        variationsOverdue: 0,
        incidentsOpen: 0,
        incidentsOverdue: 0,
        programmeOpen: 0,
        programmeOverdue: 0,
        budgetProjects: 0,
        projectsOverBudget: 0,
        budgetRevised: '0.00',
        budgetForecastFinal: '0.00',
        budgetVariance: '0.00',
      },
      projects: [
        project('prj_a', 'Alpha Tower', {
          phase: 'construction',
          siteLocation: { lat: -33.87, lng: 151.21 },
          rfis: tool(5, 2),
          attention: 2,
          budget: {
            restricted: false,
            hasBudget: true,
            revised: '100000.00',
            forecastFinal: '112500.00',
            spent: '40000.00',
            variance: '-12500.00',
            overBudgetCodes: 2,
            monthly: [
              { month: '2026-09', spent: '10000.00' },
              { month: '2026-11', spent: '30000.00' },
            ],
          },
        }),
        project('prj_b', 'Bravo Lofts', { defects: tool(1, 0), rfis: tool(0, 0, true) }),
      ],
      truncated: false,
    }));
    renderInProject(<PortfolioScreen />);
    const table = await screen.findByRole('table', { name: /Projects with open/ });
    expect(within(table).getByRole('link', { name: 'Alpha Tower' })).toBeTruthy();
    expect(within(table).getByText('2 overdue')).toBeTruthy();
    expect(screen.getByText('RFIs open').parentElement?.textContent).toBe('RFIs open52 overdue');
    // Over budget shows the shortfall; Bravo has no budget the caller can see.
    expect(within(table).getByText(/12,500\.00/)).toBeTruthy();
    expect(within(table).getByText('over budget')).toBeTruthy();
    expect(within(table).getAllByText('No access').length).toBe(2);
  });

  it('asks for closed projects when ticked', async () => {
    fake.on('GET', PORTFOLIO, () => ({
      totals: {
        projects: 0,
        rfisOpen: 0,
        rfisOverdue: 0,
        defectsOpen: 0,
        defectsOverdue: 0,
        submittalsOpen: 0,
        submittalsOverdue: 0,
        claimsOpen: 0,
        claimsOverdue: 0,
        variationsOpen: 0,
        variationsOverdue: 0,
        incidentsOpen: 0,
        incidentsOverdue: 0,
        programmeOpen: 0,
        programmeOverdue: 0,
        budgetProjects: 0,
        projectsOverBudget: 0,
        budgetRevised: '0.00',
        budgetForecastFinal: '0.00',
        budgetVariance: '0.00',
      },
      projects: [],
      truncated: false,
    }));
    renderInProject(<PortfolioScreen />);
    await screen.findByText('No projects yet');
    await userEvent.click(screen.getByLabelText('Include closed and archived projects'));
    await screen.findByText('No projects yet');
    const last = fake.callsTo('GET', PORTFOLIO).at(-1)!;
    expect(last.init.params?.query).toMatchObject({ includeClosed: 'true' });
  });
});

describe('PortfolioScreen charts', () => {
  it('draws the phase ring, a site pin and budget bars from the portfolio', async () => {
    fake.on('GET', PORTFOLIO, () => ({
      totals: {
        projects: 2,
        rfisOpen: 0,
        rfisOverdue: 0,
        defectsOpen: 0,
        defectsOverdue: 0,
        submittalsOpen: 0,
        submittalsOverdue: 0,
        claimsOpen: 0,
        claimsOverdue: 0,
        variationsOpen: 0,
        variationsOverdue: 0,
        incidentsOpen: 0,
        incidentsOverdue: 0,
        programmeOpen: 0,
        programmeOverdue: 0,
        budgetProjects: 1,
        projectsOverBudget: 0,
        budgetRevised: '100000.00',
        budgetForecastFinal: '90000.00',
        budgetVariance: '10000.00',
      },
      projects: [
        project('prj_a', 'Alpha Tower', {
          phase: 'construction',
          siteLocation: { lat: -33.87, lng: 151.21 },
          budget: {
            restricted: false,
            hasBudget: true,
            revised: '100000.00',
            forecastFinal: '90000.00',
            spent: '40000.00',
            variance: '10000.00',
            overBudgetCodes: 0,
            monthly: [],
          },
        }),
        project('prj_b', 'Bravo Lofts'),
      ],
      truncated: false,
    }));
    renderInProject(<PortfolioScreen />);
    expect(await screen.findByText('Projects by phase')).toBeTruthy();
    expect(screen.getByText('Construction')).toBeTruthy();
    expect(screen.getByText('Phase not set')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Map of project site locations' })).toBeTruthy();
    expect(screen.getByText('1 project has no site location set.')).toBeTruthy();
    expect(screen.getByText('Spent so far')).toBeTruthy();
  });
});

describe('Status report', () => {
  const budget = (revised: string, forecast: string, variance: string) => ({
    restricted: false,
    hasBudget: true,
    revised,
    forecastFinal: forecast,
    spent: '1000.00',
    variance,
    overBudgetCodes: 0,
    monthly: [],
  });
  const programme = (late: number, lateDays: number) => ({
    restricted: false,
    open: 10,
    overdue: late,
    notStarted: 4,
    completed: 5,
    lateDays,
  });
  it('rolls up cost, places projects by budget and schedule, and filters to one project', async () => {
    fake.on('GET', PORTFOLIO, () => ({
      totals: {
        projects: 3,
        rfisOpen: 0,
        rfisOverdue: 0,
        defectsOpen: 0,
        defectsOverdue: 0,
        submittalsOpen: 0,
        submittalsOverdue: 0,
        claimsOpen: 0,
        claimsOverdue: 0,
        variationsOpen: 0,
        variationsOverdue: 0,
        incidentsOpen: 0,
        incidentsOverdue: 0,
        programmeOpen: 0,
        programmeOverdue: 0,
        budgetProjects: 2,
        projectsOverBudget: 1,
        budgetRevised: '0.00',
        budgetForecastFinal: '0.00',
        budgetVariance: '0.00',
      },
      projects: [
        project('prj_a', 'Alpha Tower', {
          budget: {
            ...budget('100000.00', '90000.00', '10000.00'),
            monthly: [
              { month: '2026-09', spent: '1000.00' },
              { month: '2026-11', spent: '2500.00' },
            ],
          },
          programme: programme(0, 0),
        }),
        project('prj_b', 'Bravo Lofts', {
          budget: budget('100000.00', '120000.00', '-20000.00'),
          programme: programme(2, 9),
        }),
        project('prj_c', 'Cedar Court'),
      ],
      truncated: false,
    }));
    const user = userEvent.setup();
    renderInProject(<PortfolioScreen />);
    await user.click(await screen.findByRole('tab', { name: 'Status report' }));
    expect(await screen.findByText('Projected over/under')).toBeTruthy();
    expect(screen.getByText('over budget')).toBeTruthy(); // 200,000 budget vs 210,000 forecast
    expect(screen.getByText('Forecast as % of budget')).toBeTruthy();
    expect(screen.getByText('105%')).toBeTruthy();
    const bars = screen.getByRole('list', { name: 'Projects by budget and schedule status' });
    expect(within(bars).getByText('Over budget, off schedule').nextSibling).toBeTruthy();
    expect(within(bars).getByText('Not enough data')).toBeTruthy();
    expect(screen.getByText('4.5')).toBeTruthy(); // 9 days over 2 late tasks
    const flow = screen.getByRole('list', { name: 'Spend by month with running total' });
    expect(within(flow).getAllByRole('listitem')).toHaveLength(3); // Sep, a quiet Oct, Nov
    expect(within(flow).getByText('Oct 2026')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Project'), 'prj_a');
    expect(screen.getByText('under budget')).toBeTruthy();
    expect(screen.getByText('90%')).toBeTruthy();
  });
});

describe('ReportsScreen', () => {
  const result = {
    columns: ['project', 'ref', 'title', 'overdue'],
    rows: [
      {
        projectId: 'prj_a',
        project: 'Alpha Tower',
        ref: 'RFI-001',
        title: 'Slab edge',
        status: 'open',
        dueDate: '2020-01-10',
        overdue: true,
        createdAt: '2026-11-01T00:00:00.000Z',
      },
    ],
    restrictedProjects: 1,
    truncated: false,
    generatedAt: '2026-11-05T00:00:00.000Z',
  };

  it('runs the report as it is edited and saves it', async () => {
    fake.on('GET', REPORTS, () => ({ data: [] }));
    fake.on('GET', PROJECTS, () => ({
      data: [{ id: 'prj_a', name: 'Alpha Tower' }],
      nextCursor: null,
    }));
    fake.on('POST', PREVIEW, () => result);
    fake.on('POST', REPORTS, (init) => ({
      id: 'rpt_1',
      name: (init.body as { name: string }).name,
      shared: false,
      config: (init.body as { config: unknown }).config,
      mine: true,
      createdAt: '2026-11-05T00:00:00.000Z',
      updatedAt: '2026-11-05T00:00:00.000Z',
    }));
    renderInProject(<ReportsScreen />);
    const table = await screen.findByRole('table', { name: 'RFIs report' });
    expect(within(table).getByText('RFI-001')).toBeTruthy();
    expect(within(table).getAllByText('Overdue')).toHaveLength(2); // column header and the row's pill
    expect(screen.getByText(/1 project is left out/)).toBeTruthy();

    await userEvent.click(screen.getByLabelText('Overdue items only'));
    await vi.waitFor(() =>
      expect(fake.callsTo('POST', PREVIEW).at(-1)!.init.body).toMatchObject({ overdueOnly: true }),
    );

    const save = screen.getByRole('button', { name: 'Save report' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText('Name'), 'Overdue RFIs');
    await userEvent.click(save);
    expect(await screen.findByText('Saved “Overdue RFIs”.')).toBeTruthy();
    expect(fake.callsTo('POST', REPORTS)[0]!.init.body).toMatchObject({
      name: 'Overdue RFIs',
      config: { source: 'rfis', overdueOnly: true },
    });
  });
});

describe('toCsv', () => {
  it('writes the chosen columns, quotes commas and defuses formulas', () => {
    const csv = toCsv({
      columns: ['ref', 'title', 'overdue'],
      rows: [
        {
          projectId: 'prj_a',
          project: 'Alpha',
          ref: 'RFI-001',
          title: '=HYPERLINK("x")',
          status: 'open',
          dueDate: null,
          overdue: true,
          createdAt: '2026-11-01T00:00:00.000Z',
        },
        {
          projectId: 'prj_a',
          project: 'Alpha',
          ref: 'RFI-002',
          title: 'Slab, edge',
          status: 'open',
          dueDate: null,
          overdue: false,
          createdAt: '2026-11-01T00:00:00.000Z',
        },
      ],
    });
    expect(csv).toBe(
      'Reference,Title,Overdue\r\nRFI-001,"\'=HYPERLINK(""x"")",Yes\r\nRFI-002,"Slab, edge",No\r\n',
    );
  });

  it('keeps columns in display order', () => {
    expect(orderColumns(['overdue', 'ref', 'project'])).toEqual(['project', 'ref', 'overdue']);
  });
});

const READINESS = '/v1/orgs/{orgId}/readiness-pack';

describe('ReadinessScreen', () => {
  it('shows each section, what needs attention, and a restricted section as not shown', async () => {
    fake.on('GET', READINESS, () => ({
      generatedOn: '2026-11-05',
      timeZone: 'Australia/Sydney',
      prequal: {
        restricted: true,
        companies: 0,
        qualified: 0,
        expiring: 0,
        pending: 0,
        expired: 0,
        notQualified: 0,
        requiredForTenders: false,
      },
      credentials: {
        restricted: false,
        current: 0,
        expiring: 0,
        expired: 1,
        noExpiry: 0,
        items: [
          {
            itemType: 'public_liability',
            title: 'PL policy',
            insurer: 'Acme',
            expiresOn: '2026-10-01',
            evidence: 'sighted',
            state: 'expired',
          },
        ],
      },
      safety: {
        projectsCovered: 2,
        projectsRestricted: 1,
        incidents: { total: 3, notifiable: 0, notClosed: 1, high: 0, critical: 0 },
        swms: { accepted: 4, expired: 0, awaitingReview: 0, rejected: 0 },
      },
      trust: {
        projectsCovered: 3,
        projectsRestricted: 0,
        subcontracts: 2,
        ok: 1,
        shortfall: 1,
        notSetUp: 0,
        notRequired: 0,
        shortfallCents: 12_500,
      },
      attention: [{ area: 'credentials', text: '1 licence or insurance past expiry.' }],
      truncated: false,
    }));
    renderInProject(<ReadinessScreen />);
    expect(await screen.findByText('1 licence or insurance past expiry.')).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Licences and insurance' });
    expect(within(table).getByText('Public liability')).toBeTruthy();
    expect(within(table).getByText('Expired')).toBeTruthy();
    expect(screen.getByText(/You don't have access to prequalification/)).toBeTruthy();
    expect(screen.getByText(/1 left out because you can't open them/)).toBeTruthy();
    expect(screen.getByText('1 ($125.00)')).toBeTruthy();
  });
});
