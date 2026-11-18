// Prefabricated and modular construction: the units built off site (bathroom pods, wall panels, volumetric modules),
// their fabrication and QA gates, the shipping and install schedule, and the rules that flag trouble. Pure; the use
// cases are in application/. Everything here is rule-based (no model), so the flags and date plan cost nothing.
import { addBusinessDays, compareLocalDates, daysBetween, type LocalDate } from '@archova/time';

export const UNIT_KINDS = [
  'bathroom_pod',
  'wall_panel',
  'floor_cassette',
  'volumetric_module',
  'roof_truss',
  'facade_panel',
  'services_riser',
  'other',
] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

export const UNIT_STATUSES = [
  'planned',
  'in_fabrication',
  'qa_hold',
  'ready_to_ship',
  'in_transit',
  'on_site',
  'installed',
  'rejected',
] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

/** Statuses in the order a unit moves through them; `rejected` is off the line. */
const RANK: Record<UnitStatus, number> = {
  planned: 0,
  in_fabrication: 1,
  qa_hold: 1,
  ready_to_ship: 2,
  in_transit: 3,
  on_site: 4,
  installed: 5,
  rejected: -1,
};
export const isOpen = (s: UnitStatus) => s !== 'installed' && s !== 'rejected';
/** Still at the factory, so the fabrication dates apply. */
export const atFactory = (s: UnitStatus) => RANK[s] >= 0 && RANK[s] <= 1;
/** Not yet on site, so the ship date applies. */
export const beforeSite = (s: UnitStatus) => RANK[s] >= 0 && RANK[s] <= 3;

export type Action =
  'start' | 'hold' | 'resume' | 'ready' | 'ship' | 'deliver' | 'install' | 'reject' | 'reopen';

export const TRANSITIONS: Record<Action, { from: readonly UnitStatus[]; to: UnitStatus }> = {
  start: { from: ['planned'], to: 'in_fabrication' },
  hold: { from: ['in_fabrication', 'ready_to_ship'], to: 'qa_hold' },
  resume: { from: ['qa_hold'], to: 'in_fabrication' },
  ready: { from: ['in_fabrication'], to: 'ready_to_ship' },
  ship: { from: ['ready_to_ship'], to: 'in_transit' },
  deliver: { from: ['in_transit'], to: 'on_site' },
  install: { from: ['on_site'], to: 'installed' },
  reject: {
    from: ['in_fabrication', 'qa_hold', 'ready_to_ship', 'in_transit', 'on_site'],
    to: 'rejected',
  },
  reopen: { from: ['rejected'], to: 'planned' },
};
export const canDo = (status: UnitStatus, action: Action) =>
  TRANSITIONS[action].from.includes(status);

export type CheckStage = 'factory' | 'site';
export type CheckResult = 'pending' | 'pass' | 'fail' | 'na';

export interface CheckView {
  id: string;
  stage: CheckStage;
  required: boolean;
  result: CheckResult;
}

/** The checks that must pass (or be marked not applicable) before the unit may leave the factory or be installed. */
export function openChecks(checks: readonly CheckView[], stage: CheckStage) {
  return checks.filter(
    (c) => c.stage === stage && c.required && c.result !== 'pass' && c.result !== 'na',
  );
}
export const failedChecks = (checks: readonly CheckView[]) =>
  checks.filter((c) => c.result === 'fail');

/** The gate an action must clear: the stage whose required checks are all done. */
export const GATE: Partial<Record<Action, CheckStage>> = { ready: 'factory', install: 'site' };

export interface CheckTemplate {
  label: string;
  stage: CheckStage;
  required: boolean;
}
const f = (label: string, required = true): CheckTemplate => ({
  label,
  stage: 'factory',
  required,
});
const s = (label: string, required = true): CheckTemplate => ({ label, stage: 'site', required });

const COMMON_FACTORY = [
  f('Dimensions and squareness within tolerance'),
  f('Fixings and connections inspected'),
  f('Lifting points tested and tagged'),
  f('Protection and wrapping for transport'),
  f('Factory QA record signed off'),
];
const COMMON_SITE = [
  s('Delivery inspected for transport damage'),
  s('Lifting plan and exclusion zone confirmed'),
  s('Installed to level and line'),
  s('Connections made and inspected'),
];
const EXTRA: Partial<Record<UnitKind, CheckTemplate[]>> = {
  bathroom_pod: [
    f('Waterproofing membrane and flood test'),
    f('Plumbing pressure test'),
    f('Electrical test and tag'),
    s('Services connected and commissioned'),
  ],
  volumetric_module: [
    f('Structural frame inspection'),
    f('Fire-rated lining and penetrations'),
    s('Stitching and sealing between modules'),
    s('Services connected and commissioned'),
  ],
  wall_panel: [f('Insulation and vapour barrier fitted'), s('Bracing and tie-down fixed')],
  facade_panel: [f('Glazing and seals inspected'), s('Weatherproofing between panels checked')],
  floor_cassette: [f('Load rating and span confirmed'), s('Bearing and fixings checked')],
  roof_truss: [f('Truss certificate on file'), s('Bracing and tie-down fixed')],
  services_riser: [f('Pressure and continuity tests'), s('Tie-ins to base building checked')],
};
/** The QA checklist a new unit starts with; people add or remove their own. */
export const defaultChecks = (kind: UnitKind): CheckTemplate[] => [
  ...COMMON_FACTORY,
  ...(EXTRA[kind] ?? []).filter((c) => c.stage === 'factory'),
  ...COMMON_SITE,
  ...(EXTRA[kind] ?? []).filter((c) => c.stage === 'site'),
];

/** Working days a unit of each kind usually spends in the factory, used to propose dates. */
export const TYPICAL_FAB_DAYS: Record<UnitKind, number> = {
  bathroom_pod: 5,
  wall_panel: 4,
  floor_cassette: 6,
  volumetric_module: 20,
  roof_truss: 5,
  facade_panel: 10,
  services_riser: 8,
  other: 10,
};

export interface DatePlanInput {
  installDate: LocalDate;
  kind: UnitKind;
  fabDays?: number | undefined;
  transitDays?: number | undefined;
  /** Working days between arriving on site and install (laydown, inspection). */
  bufferDays?: number | undefined;
}
export interface DatePlan {
  fabStart: LocalDate;
  fabDue: LocalDate;
  shipDate: LocalDate;
  deliveryDate: LocalDate;
  installDate: LocalDate;
  fabDays: number;
  transitDays: number;
  bufferDays: number;
}

/** Plans backwards from the install date: buffer, transit and fabrication, all in working days. */
export function planDates(input: DatePlanInput, holidays?: ReadonlySet<LocalDate>): DatePlan {
  const cal = holidays ? { holidays } : {};
  const fabDays = input.fabDays ?? TYPICAL_FAB_DAYS[input.kind];
  const transitDays = input.transitDays ?? 1;
  const bufferDays = input.bufferDays ?? 1;
  const deliveryDate = addBusinessDays(input.installDate, -bufferDays, cal);
  const shipDate = addBusinessDays(deliveryDate, -transitDays, cal);
  const fabDue = addBusinessDays(shipDate, -1, cal); // a day's slack for final QA and loading
  const fabStart = addBusinessDays(fabDue, -Math.max(fabDays - 1, 0), cal);
  return {
    fabStart,
    fabDue,
    shipDate,
    deliveryDate,
    installDate: input.installDate,
    fabDays,
    transitDays,
    bufferDays,
  };
}

export interface UnitView {
  id: string;
  number: number;
  code: string;
  name: string;
  status: UnitStatus;
  progressPct: number;
  installSequence: number | null;
  fabStart: LocalDate | null;
  fabDue: LocalDate | null;
  shipDate: LocalDate | null;
  installDate: LocalDate | null;
  hasDelivery: boolean;
  failedChecks: number;
  openFactoryChecks: number;
  openSiteChecks: number;
}

export type FlagKind =
  | 'fab_late'
  | 'fab_not_started'
  | 'qa_hold'
  | 'ship_late'
  | 'delivery_not_booked'
  | 'install_overdue'
  | 'out_of_sequence'
  | 'dates_inconsistent';
export type Severity = 'high' | 'medium' | 'low';
export interface Flag {
  unitId: string;
  kind: FlagKind;
  severity: Severity;
  message: string;
  relatedUnitIds: string[];
}

/** Days ahead of the ship date within which an unbooked delivery is raised. */
export const DELIVERY_BOOKING_HORIZON_DAYS = 7;

const SEVERITY: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** What is wrong or about to go wrong, worst first. `today` is the project's local date. */
export function computeFlags(units: readonly UnitView[], today: LocalDate): Flag[] {
  const out: Flag[] = [];
  const raise = (
    u: UnitView,
    kind: FlagKind,
    severity: Severity,
    message: string,
    related: string[] = [],
  ) => out.push({ unitId: u.id, kind, severity, message, relatedUnitIds: related });
  const late = (d: LocalDate) => daysBetween(d, today);
  const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

  for (const u of units) {
    if (!isOpen(u.status)) continue;
    const label = `${u.code} ${u.name}`;

    if (atFactory(u.status) && u.fabDue && compareLocalDates(u.fabDue, today) < 0) {
      const n = late(u.fabDue);
      raise(
        u,
        'fab_late',
        n > 3 ? 'high' : 'medium',
        `${label} was due out of the factory ${days(n)} ago and is at ${u.progressPct}%.`,
      );
    }
    if (u.status === 'planned' && u.fabStart && compareLocalDates(u.fabStart, today) < 0) {
      raise(
        u,
        'fab_not_started',
        'medium',
        `${label} should have started fabrication ${days(late(u.fabStart))} ago.`,
      );
    }
    if (u.status === 'qa_hold') {
      raise(
        u,
        'qa_hold',
        u.shipDate && daysBetween(today, u.shipDate) <= 3 ? 'high' : 'medium',
        `${label} is on QA hold${u.failedChecks ? ` with ${u.failedChecks} failed check${u.failedChecks === 1 ? '' : 's'}` : ''}.`,
      );
    }
    if (
      beforeSite(u.status) &&
      u.status !== 'in_transit' &&
      u.shipDate &&
      compareLocalDates(u.shipDate, today) < 0
    ) {
      raise(
        u,
        'ship_late',
        'high',
        `${label} was due to ship ${days(late(u.shipDate))} ago and has not left the factory.`,
      );
    }
    if (
      beforeSite(u.status) &&
      !u.hasDelivery &&
      u.shipDate &&
      daysBetween(today, u.shipDate) <= DELIVERY_BOOKING_HORIZON_DAYS
    ) {
      raise(
        u,
        'delivery_not_booked',
        'medium',
        `${label} ships ${u.shipDate} and has no site delivery booked yet.`,
      );
    }
    if (u.installDate && compareLocalDates(u.installDate, today) < 0) {
      raise(
        u,
        'install_overdue',
        u.status === 'on_site' ? 'medium' : 'high',
        `${label} was due to be installed ${days(late(u.installDate))} ago.`,
      );
    }
    const dates = [u.fabDue, u.shipDate, u.installDate].filter((d): d is LocalDate => !!d);
    if (dates.some((d, i) => i > 0 && compareLocalDates(d, dates[i - 1]!) < 0)) {
      raise(
        u,
        'dates_inconsistent',
        'low',
        `${label} has dates out of order: fabrication, then shipping, then install.`,
      );
    }
  }

  // Install sequence: a unit must not go in (or reach site) ahead of a lower-numbered unit that is still short of site.
  const sequenced = units.filter((u) => u.installSequence !== null && u.status !== 'rejected');
  for (const u of sequenced) {
    if (RANK[u.status] < RANK.on_site) continue;
    const behind = sequenced.filter(
      (o) => o.installSequence! < u.installSequence! && RANK[o.status] < RANK.on_site,
    );
    if (behind.length > 0 && u.status !== 'installed') {
      raise(
        u,
        'out_of_sequence',
        'medium',
        `${u.code} is on site ahead of ${behind.map((b) => b.code).join(', ')} in the install sequence.`,
        behind.map((b) => b.id),
      );
    } else if (behind.length > 0) {
      raise(
        u,
        'out_of_sequence',
        'high',
        `${u.code} was installed before ${behind.map((b) => b.code).join(', ')} in the install sequence.`,
        behind.map((b) => b.id),
      );
    }
  }

  return out.sort(
    (a, b) => SEVERITY[a.severity] - SEVERITY[b.severity] || a.unitId.localeCompare(b.unitId),
  );
}

export interface Summary {
  total: number;
  byStatus: Record<UnitStatus, number>;
  /** Share of non-rejected units installed, by count. */
  installedPct: number;
  nextInstalls: { unitId: string; code: string; installDate: LocalDate }[];
}

export function summarise(units: readonly UnitView[], today: LocalDate): Summary {
  const byStatus = Object.fromEntries(UNIT_STATUSES.map((s) => [s, 0])) as Record<
    UnitStatus,
    number
  >;
  for (const u of units) byStatus[u.status] += 1;
  const live = units.length - byStatus.rejected;
  return {
    total: units.length,
    byStatus,
    installedPct: live === 0 ? 0 : Math.round((byStatus.installed / live) * 100),
    nextInstalls: units
      .filter(
        (u) => isOpen(u.status) && u.installDate && compareLocalDates(u.installDate, today) >= 0,
      )
      .sort(
        (a, b) => compareLocalDates(a.installDate!, b.installDate!) || a.code.localeCompare(b.code),
      )
      .slice(0, 5)
      .map((u) => ({ unitId: u.id, code: u.code, installDate: u.installDate! })),
  };
}
