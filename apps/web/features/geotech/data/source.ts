// Civil and geotech data source, mirroring `{p}/geotech/...` (geotech module). Preview: an in-memory project with
// the server's rules (pass/fail from the typed limits, cut/fill balance by zone, Nova flags).

import { delay, mockId, problem, projectStores } from '@/shared/mocks/runtime';
import type {
  EarthworksEntry,
  EarthworksInput,
  EarthworksSummary,
  GeotechFlag,
  GeotechTest,
  Investigation,
  InvestigationInput,
  TestFilters,
  TestInput,
  TestOutcome,
} from '../lib/types';

export interface GeotechSource {
  investigations(projectId: string): Promise<Investigation[]>;
  createInvestigation(projectId: string, input: InvestigationInput): Promise<Investigation>;
  tests(projectId: string, filters: TestFilters): Promise<GeotechTest[]>;
  createTest(projectId: string, input: TestInput): Promise<GeotechTest>;
  deleteTest(projectId: string, id: string): Promise<void>;
  earthworks(projectId: string): Promise<EarthworksEntry[]>;
  createEarthworks(projectId: string, input: EarthworksInput): Promise<EarthworksEntry>;
  deleteEarthworks(projectId: string, id: string): Promise<void>;
  summary(projectId: string): Promise<EarthworksSummary>;
  flags(projectId: string): Promise<GeotechFlag[]>;
}

interface Store {
  investigations: Investigation[];
  tests: GeotechTest[];
  earthworks: EarthworksEntry[];
  next: number;
}

const NOW = '2026-11-10T00:00:00.000Z';
const outcome = (v: number, min: number | null, max: number | null): TestOutcome =>
  min === null && max === null
    ? 'no_spec'
    : (min !== null && v < min) || (max !== null && v > max)
      ? 'fail'
      : 'pass';
const round = (n: number) => Math.round(n * 1000) / 1000;

export function summarise(rows: EarthworksEntry[]): EarthworksSummary {
  const zones = new Map<string, EarthworksSummary['total'] & { zone: string }>();
  for (const e of rows) {
    const z = zones.get(e.zone) ?? {
      zone: e.zone,
      cut: 0,
      fill: 0,
      imported: 0,
      exported: 0,
      balance: 0,
    };
    if (e.kind === 'cut') z.cut += e.volumeM3;
    else if (e.kind === 'fill') z.fill += e.volumeM3;
    else if (e.kind === 'import') z.imported += e.volumeM3;
    else z.exported += e.volumeM3;
    zones.set(e.zone, z);
  }
  const fin = <T extends EarthworksSummary['total']>(z: T): T => ({
    ...z,
    cut: round(z.cut),
    fill: round(z.fill),
    imported: round(z.imported),
    exported: round(z.exported),
    balance: round(z.cut + z.imported - z.fill - z.exported),
  });
  const list = [...zones.values()].map(fin).sort((a, b) => a.zone.localeCompare(b.zone));
  const total = fin(
    list.reduce(
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
  return { zones: list, total };
}

const stores = projectStores<Store>(() => ({
  next: 3,
  investigations: [
    {
      id: 'gin_0001',
      projectId: 'preview',
      number: 1,
      numberLabel: 'GEO-0001',
      kind: 'borehole',
      title: 'BH1 north boundary',
      location: 'North boundary, 5 m off the fence',
      latitude: null,
      longitude: null,
      depthM: 6.5,
      groundwaterDepthM: 3.2,
      investigatedOn: '2026-10-02',
      consultantCompanyId: null,
      summary: 'Fill over stiff clay, refusal on weathered rock at 6.5 m.',
      fileIds: ['fil_0001'],
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
    },
    {
      id: 'gin_0002',
      projectId: 'preview',
      number: 2,
      numberLabel: 'GEO-0002',
      kind: 'test_pit',
      title: 'TP2 lot B',
      location: null,
      latitude: null,
      longitude: null,
      depthM: 2.4,
      groundwaterDepthM: null,
      investigatedOn: '2026-10-03',
      consultantCompanyId: null,
      summary: null,
      fileIds: [],
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
    },
  ],
  tests: [
    {
      id: 'gts_0001',
      projectId: 'preview',
      investigationId: 'gin_0001',
      kind: 'cbr',
      sampleRef: 'S-2',
      zone: 'Lot A',
      depthFromM: 0.5,
      depthToM: 1,
      value: 18,
      unit: '%',
      specMin: 15,
      specMax: null,
      result: 'pass',
      testedOn: '2026-10-08',
      lab: 'Coastal Labs',
      notes: null,
      createdAt: NOW,
    },
    {
      id: 'gts_0002',
      projectId: 'preview',
      investigationId: null,
      kind: 'field_density_ratio',
      sampleRef: 'FD-14',
      zone: 'Lot B',
      depthFromM: null,
      depthToM: null,
      value: 92,
      unit: '%',
      specMin: 95,
      specMax: null,
      result: 'fail',
      testedOn: '2026-11-04',
      lab: null,
      notes: 'Retest after recompaction',
      createdAt: NOW,
    },
  ],
  earthworks: [
    ['Lot A', 'cut', 1200],
    ['Lot A', 'fill', 900],
    ['Lot B', 'cut', 400],
    ['Lot B', 'fill', 700],
  ].map(([zone, kind, v], i) => ({
    id: `gew_000${i}`,
    projectId: 'preview',
    zone: zone as string,
    kind: kind as EarthworksEntry['kind'],
    volumeM3: v as number,
    material: null,
    recordedOn: '2026-11-05',
    notes: null,
    createdAt: NOW,
  })),
}));

export const geotechPreview: GeotechSource = {
  investigations: (p) => delay([...stores.get(p).investigations].reverse()),
  createInvestigation: (p, input) => {
    const s = stores.get(p);
    const number = s.next++;
    const row: Investigation = {
      id: mockId('gin'),
      projectId: p,
      number,
      numberLabel: `GEO-${String(number).padStart(4, '0')}`,
      kind: input.kind,
      title: input.title,
      location: input.location ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      depthM: input.depthM ?? null,
      groundwaterDepthM: input.groundwaterDepthM ?? null,
      investigatedOn: input.investigatedOn ?? null,
      consultantCompanyId: input.consultantCompanyId ?? null,
      summary: input.summary ?? null,
      fileIds: input.fileIds ?? [],
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
    };
    s.investigations.push(row);
    return delay(row);
  },
  tests: (p, f) =>
    delay([...stores.get(p).tests].reverse().filter((t) => !f.result || t.result === f.result)),
  createTest: (p, input) => {
    if (
      input.specMin !== undefined &&
      input.specMin !== null &&
      input.specMax !== undefined &&
      input.specMax !== null &&
      input.specMin > input.specMax
    )
      problem(422, 'validation_failed', 'The minimum is above the maximum.');
    const row: GeotechTest = {
      id: mockId('gts'),
      projectId: p,
      investigationId: input.investigationId ?? null,
      kind: input.kind,
      sampleRef: input.sampleRef ?? null,
      zone: input.zone ?? null,
      depthFromM: input.depthFromM ?? null,
      depthToM: input.depthToM ?? null,
      value: input.value,
      unit: input.unit ?? '',
      specMin: input.specMin ?? null,
      specMax: input.specMax ?? null,
      result: outcome(input.value, input.specMin ?? null, input.specMax ?? null),
      testedOn: input.testedOn,
      lab: input.lab ?? null,
      notes: input.notes ?? null,
      createdAt: NOW,
    };
    stores.get(p).tests.push(row);
    return delay(row);
  },
  deleteTest: (p, id) => {
    const s = stores.get(p);
    s.tests = s.tests.filter((t) => t.id !== id);
    return delay(undefined);
  },
  earthworks: (p) => delay([...stores.get(p).earthworks].reverse()),
  createEarthworks: (p, input) => {
    if (!(input.volumeM3 > 0)) problem(422, 'validation_failed', 'Enter a volume above zero.');
    const row: EarthworksEntry = {
      id: mockId('gew'),
      projectId: p,
      zone: input.zone.trim(),
      kind: input.kind,
      volumeM3: input.volumeM3,
      material: input.material ?? null,
      recordedOn: input.recordedOn,
      notes: input.notes ?? null,
      createdAt: NOW,
    };
    stores.get(p).earthworks.push(row);
    return delay(row);
  },
  deleteEarthworks: (p, id) => {
    const s = stores.get(p);
    s.earthworks = s.earthworks.filter((e) => e.id !== id);
    return delay(undefined);
  },
  summary: (p) => delay(summarise(stores.get(p).earthworks)),
  flags: (p) => {
    const s = stores.get(p);
    const out: GeotechFlag[] = [];
    for (const t of s.tests)
      if (t.result === 'fail')
        out.push({
          kind: 'failed_test',
          severity: 'high',
          title: `${t.kind.toUpperCase()} test outside its limits`,
          detail: `${t.sampleRef ?? 'A sample'}${t.zone ? ` in ${t.zone}` : ''} is outside the spec range typed on the result. Check whether a retest or rework is needed.`,
          refId: t.id,
        });
    for (const z of summarise(s.earthworks).zones)
      if (z.balance < 0 && z.fill > 0)
        out.push({
          kind: 'short_of_fill',
          severity: 'medium',
          title: `${z.zone} is short of fill`,
          detail: `Fill placed exceeds cut and imports by ${Math.abs(z.balance)} m³.`,
          refId: null,
        });
    for (const i of s.investigations)
      if (i.fileIds.length === 0)
        out.push({
          kind: 'no_report',
          severity: 'medium',
          title: `${i.numberLabel} has no log or report attached`,
          detail: `${i.title}: attach the borehole log or consultant report.`,
          refId: i.id,
        });
    return delay(out);
  },
};

export function resetGeotechPreview() {
  stores.reset();
}
