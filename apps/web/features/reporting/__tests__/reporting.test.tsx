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

const tool = (open: number, overdue: number, restricted = false, dueSoon = 0) => ({
  restricted,
  open,
  overdue,
  dueSoon,
});
const project = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  number: null,
  status: 'active',
  phase: null,
  state: null,
  siteLocation: null,
  observations: tool(0, 0),
  inspections: tool(0, 0),
  rfis: tool(0, 0),
  defects: tool(0, 0),
  submittals: tool(0, 0),
  claims: tool(0, 0),
  variations: tool(0, 0),
  incidents: {
    ...tool(0, 0),
    lastInjuryOn: null,
    lastIncidentOn: null,
    daysSinceInjury: null,
    daysSinceIncident: null,
    last12Months: 0,
  },
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

const SUSTAINABILITY = '/v1/orgs/{orgId}/portfolio/sustainability';
const sProject = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  number: null,
  status: 'active',
  phase: null,
  state: null,
  restricted: false,
  hasPlan: true,
  conditions: { nonCompliant: 0, overdue: 0, compliancePercent: 100 },
  documentsLapsing: 0,
  monitoring: { points: 1, openBreaches: 0, overdue: 0 },
  waste: {
    totalTonnes: 100,
    divertedTonnes: 90,
    landfillTonnes: 10,
    diversionPercent: 90,
    last30Tonnes: 20,
    last30DivertedTonnes: 18,
    last30DiversionPercent: 90,
    previous30Tonnes: 20,
    previous30DivertedTonnes: 18,
    previous30DiversionPercent: 90,
    regulatedWithoutDocket: 0,
  },
  carbon: { totalKg: 5000, last30Kg: 1000, previous30Kg: 1000, changePercent: 0 },
  attention: 0,
  ...over,
});

describe('Sustainability view', () => {
  it('shows totals, Nova flags, and a row per project with the falling diversion called out', async () => {
    fake.on('GET', PORTFOLIO, () => ({
      totals: {},
      projects: [],
      truncated: false,
    }));
    fake.on('GET', SUSTAINABILITY, () => ({
      totals: {
        projectsCovered: 2,
        projectsRestricted: 1,
        projectsWithoutPlan: 0,
        openBreaches: 2,
        nonCompliantConditions: 1,
        overdueConditions: 0,
        documentsLapsing: 0,
        wasteTonnes: 300,
        landfillTonnes: 90,
        diversionPercent: 68,
        last30DiversionPercent: 60,
        previous30DiversionPercent: 80,
        carbonKg: 9000,
        carbonLast30Kg: 3000,
        carbonPrevious30Kg: 2000,
        carbonChangePercent: 50,
      },
      projects: [
        sProject('prj_a', 'Alpha Tower', {
          monitoring: { points: 2, openBreaches: 2, overdue: 0 },
          conditions: { nonCompliant: 1, overdue: 0, compliancePercent: 50 },
          waste: {
            totalTonnes: 200,
            divertedTonnes: 120,
            landfillTonnes: 80,
            diversionPercent: 60,
            last30Tonnes: 20,
            last30DivertedTonnes: 10,
            last30DiversionPercent: 50,
            previous30Tonnes: 20,
            previous30DivertedTonnes: 16,
            previous30DiversionPercent: 80,
            regulatedWithoutDocket: 0,
          },
          attention: 8,
        }),
        sProject('prj_b', 'Bravo Lofts', { restricted: true }),
      ],
      flags: [
        {
          code: 'breach_open',
          severity: 'critical',
          projectId: 'prj_a',
          projectName: 'Alpha Tower',
          message: '2 monitoring breaches waiting for a response.',
        },
      ],
      truncated: false,
    }));
    const user = userEvent.setup();
    renderInProject(<PortfolioScreen />);
    await user.click(await screen.findByRole('tab', { name: 'Sustainability' }));
    const flags = await screen.findByLabelText('Nova flags');
    expect(within(flags).getByText(/2 monitoring breaches waiting/)).toBeTruthy();
    expect(screen.getByText('Down 20 points on the 30 days before')).toBeTruthy();
    const table = await screen.findByRole('table', { name: 'Projects by sustainability' });
    expect(within(table).getByRole('link', { name: 'Alpha Tower' })).toBeTruthy();
    expect(within(table).getByText('Falling')).toBeTruthy();
    expect(within(table).getByText('2 open')).toBeTruthy();
    expect(within(table).getByText('No access')).toBeTruthy();
    expect(screen.getByText(/1 project is left out/)).toBeTruthy();
  });
});

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
  it('lets an admin add a tile from the library and saves the layout for the company', async () => {
    const zero = Object.fromEntries(
      [
        'projects',
        'rfisOpen',
        'rfisOverdue',
        'defectsOpen',
        'defectsOverdue',
        'submittalsOpen',
        'submittalsOverdue',
        'claimsOpen',
        'claimsOverdue',
        'variationsOpen',
        'variationsOverdue',
        'incidentsOpen',
        'incidentsOverdue',
        'programmeOpen',
        'programmeOverdue',
        'budgetProjects',
        'projectsOverBudget',
      ].map((k) => [k, 0]),
    );
    fake.on('GET', PORTFOLIO, () => ({
      totals: {
        ...zero,
        budgetRevised: '0.00',
        budgetForecastFinal: '0.00',
        budgetVariance: '0.00',
      },
      projects: [],
      truncated: false,
    }));
    const B = '/v1/orgs/{orgId}/branding';
    const branding = {
      logoFileId: null,
      accentColor: null,
      dashboardWidgets: ['rfis'],
      dashboardLayout: null,
      availableWidgets: [{ key: 'rfis', label: 'RFIs open' }],
      version: 1,
    };
    fake.on('GET', B, () => branding);
    fake.on('PUT', B, () => branding);
    renderInProject(<PortfolioScreen />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit layout' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add tiles' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Text box' }));
    expect(screen.getByRole('button', { name: /^Move Text box/ })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    await screen.findByRole('button', { name: 'Edit layout' });
    const body = fake.callsTo('PUT', B).at(-1)!.init.body as { dashboardLayout: unknown[] };
    expect(body.dashboardLayout).toMatchObject([
      { id: 'rfis', type: 'stat_rfis', x: 0, y: 0, w: 3, h: 2 },
      { type: 'portfolio_charts', x: 0, y: 2, w: 12, h: 7 },
      { type: 'text_box', x: 0, y: 9, w: 4, h: 3 },
    ]);
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
    dueSoon: 0,
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

describe('Project overview tab', () => {
  it('shows a row per tool with overdue, next 7 days and later, and lets a row be hidden', async () => {
    fake.on('GET', PORTFOLIO, () => ({
      totals: {
        projects: 1,
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
      projects: [project('prj_a', 'Alpha Tower', { rfis: tool(10, 3, false, 2) })],
      truncated: false,
    }));
    const user = userEvent.setup();
    renderInProject(<PortfolioScreen />);
    await user.click(await screen.findByRole('tab', { name: 'Project overview' }));
    const table = await screen.findByRole('table', { name: /Open items on Alpha Tower/ });
    const rfiRow = within(table).getByRole('row', { name: /RFIs/ });
    expect(within(rfiRow).getByRole('link', { name: '3 overdue RFIs' })).toBeTruthy();
    const cells = within(rfiRow).getAllByRole('cell');
    expect(cells.map((c) => c.textContent)).toEqual(['', '3', '2', '5', '10']);
    await user.click(screen.getByRole('button', { name: 'Choose rows' }));
    await user.click(screen.getByRole('checkbox', { name: 'RFIs' }));
    expect(within(table).queryByRole('row', { name: /^RFIs/ })).toBeNull();
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

describe('MyWorkScreen', () => {
  const item = (over: Record<string, unknown> = {}) => ({
    source: 'rfis',
    projectId: 'prj_a',
    project: 'Alpha Tower',
    ref: 'RFI-001',
    title: 'Slab edge detail',
    status: 'open',
    dueDate: '2026-11-01',
    createdAt: '2026-11-02T00:00:00.000Z',
    bucket: 'overdue',
    ...over,
  });
  const empty = {
    counts: { overdue: 0, today: 0, next7: 0 },
    items: [],
    recent: [],
    restrictedProjects: 0,
    truncated: false,
    generatedAt: '2026-11-06T00:00:00.000Z',
  };

  it('shows counts, what is due across projects, and bookmarks', async () => {
    fake.on('GET', '/v1/orgs/{orgId}/bookmarks', () => ({
      data: [
        {
          id: 'bmk_1',
          entityType: 'rfi',
          entityId: 'rfi_1',
          projectId: 'prj_a',
          title: 'RFI-001 Slab edge detail',
          subtitle: '',
          createdAt: '2026-11-05T00:00:00.000Z',
        },
      ],
    }));
    fake.on('GET', '/v1/orgs/{orgId}/my-work', () => ({
      ...empty,
      counts: { overdue: 1, today: 0, next7: 1 },
      items: [
        item(),
        item({ ref: 'DEF-002', source: 'defects', dueDate: '2026-11-08', bucket: 'next7' }),
      ],
      recent: [item()],
      restrictedProjects: 1,
    }));
    const { MyWorkScreen } = await import('../screens/MyWorkScreen');
    renderInProject(<MyWorkScreen />);
    const due = await screen.findByRole('table', { name: /overdue or due in the next 7 days/ });
    expect(within(due).getByText('Overdue')).toBeTruthy();
    expect(within(due).getByText('Next 7 days')).toBeTruthy();
    expect(within(due).getAllByRole('link', { name: 'Alpha Tower' }).length).toBe(2);
    expect(await screen.findByRole('link', { name: 'RFI-001 Slab edge detail' })).toBeTruthy();
    expect(screen.getByText('Some projects are partly hidden')).toBeTruthy();
  });

  it('shows empty states when nothing is due', async () => {
    fake.on('GET', '/v1/orgs/{orgId}/bookmarks', () => ({ data: [] }));
    fake.on('GET', '/v1/orgs/{orgId}/my-work', () => empty);
    const { MyWorkScreen } = await import('../screens/MyWorkScreen');
    renderInProject(<MyWorkScreen />);
    expect(await screen.findByText('Nothing due')).toBeTruthy();
    expect(screen.getByText('No bookmarks yet')).toBeTruthy();
  });
});
