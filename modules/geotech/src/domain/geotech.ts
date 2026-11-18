// Civil and geotechnical records: the rules, with no I/O. A test result is judged only against the spec limits
// typed on it; the register never says a material "complies", only whether the number is inside the stated range.

export const INVESTIGATION_KINDS = [
  'borehole',
  'test_pit',
  'cpt',
  'dcp',
  'plate_load',
  'groundwater_bore',
  'other',
] as const;
export type InvestigationKind = (typeof INVESTIGATION_KINDS)[number];

export const TEST_KINDS = [
  'cbr',
  'mdd',
  'omc',
  'moisture_content',
  'field_density_ratio',
  'plasticity_index',
  'liquid_limit',
  'ucs',
  'particle_size',
  'other',
] as const;
export type TestKind = (typeof TEST_KINDS)[number];

export const TEST_KIND_UNITS: Record<TestKind, string> = {
  cbr: '%',
  mdd: 't/m³',
  omc: '%',
  moisture_content: '%',
  field_density_ratio: '%',
  plasticity_index: '%',
  liquid_limit: '%',
  ucs: 'kPa',
  particle_size: '% passing',
  other: '',
};

export type TestResult = 'pass' | 'fail' | 'no_spec';

/** Inside [min, max] (both inclusive, either optional) passes. No limits typed means no judgement. */
export function evaluateTest(
  value: number,
  specMin: number | null,
  specMax: number | null,
): TestResult {
  if (specMin === null && specMax === null) return 'no_spec';
  if (specMin !== null && value < specMin) return 'fail';
  if (specMax !== null && value > specMax) return 'fail';
  return 'pass';
}

export const EARTHWORKS_KINDS = ['cut', 'fill', 'import', 'export'] as const;
export type EarthworksKind = (typeof EARTHWORKS_KINDS)[number];

export const investigationLabel = (n: number) => `GEO-${String(n).padStart(4, '0')}`;

export interface ZoneTotals {
  zone: string;
  cut: number;
  fill: number;
  imported: number;
  exported: number;
  /** cut + import - fill - export, in m³. Positive: spare material on site. Negative: short. */
  balance: number;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function summariseEarthworks(
  entries: readonly { zone: string; kind: EarthworksKind; volumeM3: number }[],
): { zones: ZoneTotals[]; total: Omit<ZoneTotals, 'zone'> } {
  const byZone = new Map<string, ZoneTotals>();
  const blank = (zone: string): ZoneTotals => ({
    zone,
    cut: 0,
    fill: 0,
    imported: 0,
    exported: 0,
    balance: 0,
  });
  for (const e of entries) {
    const z = byZone.get(e.zone) ?? blank(e.zone);
    if (e.kind === 'cut') z.cut += e.volumeM3;
    else if (e.kind === 'fill') z.fill += e.volumeM3;
    else if (e.kind === 'import') z.imported += e.volumeM3;
    else z.exported += e.volumeM3;
    byZone.set(e.zone, z);
  }
  const finish = <T extends Omit<ZoneTotals, 'zone'>>(z: T): T => ({
    ...z,
    cut: round(z.cut),
    fill: round(z.fill),
    imported: round(z.imported),
    exported: round(z.exported),
    balance: round(z.cut + z.imported - z.fill - z.exported),
  });
  const zones = [...byZone.values()].map(finish).sort((a, b) => a.zone.localeCompare(b.zone));
  const total = finish(
    zones.reduce(
      (t, z) => ({
        cut: t.cut + z.cut,
        fill: t.fill + z.fill,
        imported: t.imported + z.imported,
        exported: t.exported + z.exported,
        balance: 0,
      }),
      { cut: 0, fill: 0, imported: 0, exported: 0, balance: 0 },
    ),
  );
  return { zones, total };
}

export type GeotechFlagKind = 'failed_test' | 'short_of_fill' | 'no_report';
export interface GeotechFlag {
  kind: GeotechFlagKind;
  severity: 'high' | 'medium';
  title: string;
  detail: string;
  refId: string | null;
}

export function geotechFlags(input: {
  failedTests: { id: string; kind: TestKind; sampleRef: string | null; zone: string | null }[];
  investigationsWithoutReport: { id: string; number: number; title: string }[];
  zones: ZoneTotals[];
}): GeotechFlag[] {
  const flags: GeotechFlag[] = [];
  for (const t of input.failedTests)
    flags.push({
      kind: 'failed_test',
      severity: 'high',
      title: `${t.kind.toUpperCase()} test outside its limits`,
      detail: `${t.sampleRef ?? 'A sample'}${t.zone ? ` in ${t.zone}` : ''} is outside the spec range typed on the result. Check whether a retest or rework is needed.`,
      refId: t.id,
    });
  for (const z of input.zones)
    if (z.balance < 0 && z.fill > 0)
      flags.push({
        kind: 'short_of_fill',
        severity: 'medium',
        title: `${z.zone} is short of fill`,
        detail: `Fill placed exceeds cut and imports by ${Math.abs(z.balance)} m³.`,
        refId: null,
      });
  for (const i of input.investigationsWithoutReport)
    flags.push({
      kind: 'no_report',
      severity: 'medium',
      title: `${investigationLabel(i.number)} has no log or report attached`,
      detail: `${i.title}: attach the borehole log or consultant report.`,
      refId: i.id,
    });
  return flags;
}
