// DBP Act insights: pure roll-up of per-project inspection and observation rows. No IO, no wording from a model.
// Items passing = answered "pass" over answered "pass" + "fail" (n/a and unanswered are not counted either way).

export const TRADE_CATEGORIES = [
  'fire_safety',
  'waterproofing',
  'structural',
  'external_cladding',
  'building_services',
  'other',
] as const;
export const CLASSIFICATIONS = ['serious_defect', 'potential_serious_defect', 'low_risk'] as const;
export const CONDITIONS = [
  'workmanship',
  'design',
  'materials',
  'supervision',
  'weather',
  'coordination',
  'documentation',
] as const;

export type TradeCategory = (typeof TRADE_CATEGORIES)[number];
export type Classification = (typeof CLASSIFICATIONS)[number];
export type Condition = (typeof CONDITIONS)[number];

export interface DbpInspection {
  tradeCategory: TradeCategory | null;
  late: boolean;
  completedOn: string | null;
  pass: number;
  fail: number;
}
export interface DbpObservation {
  tradeCategory: TradeCategory | null;
  classification: Classification | null;
  contributingCondition: Condition | null;
  late: boolean;
}
export interface DbpProjectInput {
  id: string;
  name: string;
  restricted: boolean;
  inspections: readonly DbpInspection[];
  observations: readonly DbpObservation[];
}

export type ClassCounts = Record<Classification | 'unclassified', number>;
export const TREND_MONTHS = 12;

const emptyClass = (): ClassCounts => ({
  serious_defect: 0,
  potential_serious_defect: 0,
  low_risk: 0,
  unclassified: 0,
});

/** Whole percent, or null when nothing was answered (so the gauge shows "no data", never 0%). */
export const passRate = (pass: number, fail: number): number | null =>
  pass + fail === 0 ? null : Math.round((pass / (pass + fail)) * 100);

/** The last `n` months ending at `today`'s month, oldest first, as yyyy-mm. */
export function lastMonths(today: string, n: number): string[] {
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

export function buildInsights(projects: readonly DbpProjectInput[], today: string) {
  const categories = new Map(
    [...TRADE_CATEGORIES, 'uncategorised' as const].map((c) => [
      c,
      { pass: 0, fail: 0, lateInspections: 0, lateObservations: 0, classes: emptyClass() },
    ]),
  );
  const months = new Map(lastMonths(today, TREND_MONTHS).map((m) => [m, { pass: 0, fail: 0 }]));
  const conditions = new Map<string, number>();
  const totals = emptyClass();
  const rows = [];

  for (const p of projects) {
    const classes = emptyClass();
    let lateInspections = 0;
    let lateObservations = 0;
    for (const i of p.inspections) {
      const c = categories.get(i.tradeCategory ?? 'uncategorised')!;
      c.pass += i.pass;
      c.fail += i.fail;
      if (i.late) {
        c.lateInspections += 1;
        lateInspections += 1;
      }
      const bucket = i.completedOn ? months.get(i.completedOn.slice(0, 7)) : undefined;
      if (bucket) {
        bucket.pass += i.pass;
        bucket.fail += i.fail;
      }
    }
    for (const o of p.observations) {
      const key = o.classification ?? 'unclassified';
      const c = categories.get(o.tradeCategory ?? 'uncategorised')!;
      c.classes[key] += 1;
      classes[key] += 1;
      totals[key] += 1;
      if (o.late) {
        c.lateObservations += 1;
        lateObservations += 1;
      }
      const cond = o.contributingCondition ?? 'not_recorded';
      conditions.set(cond, (conditions.get(cond) ?? 0) + 1);
    }
    rows.push({
      id: p.id,
      name: p.name,
      restricted: p.restricted,
      classifications: classes,
      lateInspections,
      lateObservations,
    });
  }

  return {
    categories: [...categories.entries()]
      .filter(
        ([k, c]) =>
          k !== 'uncategorised' ||
          c.pass +
            c.fail +
            c.lateInspections +
            c.lateObservations +
            Object.values(c.classes).reduce((a, b) => a + b, 0) >
            0,
      )
      .map(([category, c]) => ({
        category,
        itemsPassing: { pass: c.pass, fail: c.fail, rate: passRate(c.pass, c.fail) },
        lateInspections: c.lateInspections,
        lateObservations: c.lateObservations,
        classifications: c.classes,
      })),
    classificationTotals: totals,
    passRateTrend: [...months.entries()].map(([month, v]) => ({
      month,
      pass: v.pass,
      fail: v.fail,
      rate: passRate(v.pass, v.fail),
    })),
    conditions: [...conditions.entries()]
      .map(([condition, count]) => ({ condition, count }))
      .sort((a, b) => b.count - a.count),
    projects: rows.sort(
      (a, b) =>
        b.classifications.serious_defect - a.classifications.serious_defect ||
        b.lateInspections + b.lateObservations - (a.lateInspections + a.lateObservations) ||
        a.name.localeCompare(b.name),
    ),
  };
}
