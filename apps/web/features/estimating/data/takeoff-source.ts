// Takeoff data source, mirroring `CRUD {p}/takeoff-measurements` (filters: revision, sheet, package) and
// `POST {p}/takeoff-measurements/{id}/confirm` (backend 04 §3). Preview: in-memory store; quantities are
// recomputed "server side" here from geometry and the scale, as the API will.

import {
  UNIT_FOR_KIND,
  parseScale,
  roundQuantity,
  takeoffQuantity,
  type SheetSize,
} from '@archova/markup';
import { delay, mockId, nowIso, problem, projectStores } from '@/shared/mocks/runtime';
import type {
  NewMeasurement,
  NovaFindInput,
  NovaFound,
  TakeoffMeasurement,
} from '../lib/takeoff-types';
import { quotesSource } from './quotes-source';

const A1: SheetSize = { widthMm: 841, heightMm: 594 };

function seed(): TakeoffMeasurement[] {
  // Measured on A-101 Rev B before Rev C superseded it: the viewer offers these for re-check on Rev C.
  const base = {
    sheetNo: '1',
    scaleUsed: '1:100',
    scaleConfirmed: true,
    source: 'manual' as const,
    confidence: null,
    confirmed: true,
    rejected: false,
    raster: false,
    packageId: null,
    createdBy: 'Dana Okafor',
    createdAt: '2026-08-10T01:00:00Z',
  };
  const retail1 = {
    kind: 'area' as const,
    outer: [
      { x: 40 / 841, y: 40 / 594 },
      { x: 240 / 841, y: 40 / 594 },
      { x: 240 / 841, y: 260 / 594 },
      { x: 40 / 841, y: 260 / 594 },
    ],
    holes: [],
  };
  const wall = {
    kind: 'length' as const,
    points: [
      { x: 40 / 841, y: 260 / 594 },
      { x: 600 / 841, y: 260 / 594 },
    ],
  };
  const doors = {
    kind: 'count' as const,
    points: [
      { x: 140 / 841, y: 260 / 594 },
      { x: 330 / 841, y: 260 / 594 },
      { x: 510 / 841, y: 260 / 594 },
    ],
  };
  return [
    {
      ...base,
      id: 'tko_1',
      revisionId: 'rev_a101_b',
      kind: 'area',
      geometry: retail1,
      quantity: roundQuantity(takeoffQuantity(retail1, A1, 100), 'm2'),
      unit: 'm2',
      label: 'Retail 1 floor',
      trade: 'Floor finishes',
      supersededByRevisionId: 'rev_a101_c',
    },
    {
      ...base,
      id: 'tko_2',
      revisionId: 'rev_a101_b',
      kind: 'length',
      geometry: wall,
      quantity: roundQuantity(takeoffQuantity(wall, A1, 100), 'm'),
      unit: 'm',
      label: 'Grid 3 partition',
      trade: 'Plasterboard and ceilings',
      supersededByRevisionId: 'rev_a101_c',
    },
    {
      ...base,
      id: 'tko_3',
      revisionId: 'rev_a101_b',
      kind: 'count',
      geometry: doors,
      quantity: 3,
      unit: 'ea',
      label: 'Door D1',
      trade: 'Doors and hardware',
      supersededByRevisionId: 'rev_a101_c',
    },
  ];
}

const stores = projectStores<{ rows: TakeoffMeasurement[] }>(() => ({ rows: seed() }));

export interface TakeoffSource {
  list(
    projectId: string,
    filter: { revisionIds: readonly string[] },
  ): Promise<TakeoffMeasurement[]>;
  createMany(
    projectId: string,
    input: {
      items: readonly NewMeasurement[];
      scale: string;
      scaleConfirmed: boolean;
      size: SheetSize;
    },
    actor: { name: string },
  ): Promise<TakeoffMeasurement[]>;
  update(
    projectId: string,
    id: string,
    patch: Partial<Pick<TakeoffMeasurement, 'label' | 'trade' | 'packageId'>>,
  ): Promise<TakeoffMeasurement>;
  remove(projectId: string, id: string): Promise<void>;
  /** Nova finds the items and they are saved as pending marks (nothing counts until a person accepts). */
  findWithNova(projectId: string, input: NovaFindInput): Promise<NovaFound>;
  accept(projectId: string, id: string): Promise<TakeoffMeasurement>;
  reject(projectId: string, id: string): Promise<TakeoffMeasurement>;
  /** Accepts every pending Nova mark at least this sure; returns how many were accepted. */
  acceptAbove(projectId: string, revisionId: string, minConfidence: number): Promise<number>;
  sendToPackage(projectId: string, ids: readonly string[], packageId: string): Promise<number>;
}

export const takeoffSource: TakeoffSource & {
  listByPackage(projectId: string, packageId: string): Promise<TakeoffMeasurement[]>;
} = {
  async list(
    projectId: string,
    filter: { revisionIds: readonly string[] },
  ): Promise<TakeoffMeasurement[]> {
    return delay(
      stores.get(projectId).rows.filter((m) => filter.revisionIds.includes(m.revisionId)),
    );
  },

  async listByPackage(projectId: string, packageId: string): Promise<TakeoffMeasurement[]> {
    return delay(stores.get(projectId).rows.filter((m) => m.packageId === packageId));
  },

  /** Saves new measurements. The scale must be known; unconfirmed scales are recorded as such. */
  async createMany(
    projectId: string,
    input: {
      items: readonly NewMeasurement[];
      scale: string;
      scaleConfirmed: boolean;
      size: SheetSize;
    },
    actor: { name: string },
  ): Promise<TakeoffMeasurement[]> {
    const ratio = parseScale(input.scale);
    if (!ratio)
      problem(422, 'takeoff.scale_missing', 'Set the sheet scale before saving measurements.');
    const created = input.items.map((item): TakeoffMeasurement => {
      const kind = item.geometry.kind;
      const unit = UNIT_FOR_KIND[kind];
      return {
        id: mockId('tko'),
        revisionId: item.revisionId,
        sheetNo: item.sheetNo,
        kind,
        geometry: item.geometry,
        quantity: roundQuantity(takeoffQuantity(item.geometry, input.size, ratio), unit),
        unit,
        scaleUsed: input.scale,
        scaleConfirmed: input.scaleConfirmed,
        source: 'manual',
        confidence: null,
        confirmed: true,
        rejected: false,
        raster: item.raster,
        label: item.label,
        trade: item.trade,
        packageId: null,
        supersededByRevisionId: null,
        createdBy: actor.name,
        createdAt: nowIso(),
      };
    });
    stores.get(projectId).rows.push(...created);
    return delay(created);
  },

  async update(
    projectId: string,
    id: string,
    patch: Partial<Pick<TakeoffMeasurement, 'label' | 'trade' | 'packageId'>>,
  ): Promise<TakeoffMeasurement> {
    const row = stores.get(projectId).rows.find((m) => m.id === id);
    if (!row) problem(404, 'not_found', "We couldn't find that measurement.");
    Object.assign(row, patch);
    return delay(row);
  },

  /** A fixed, plausible set of marks, like the approved mockup: the preview has no model behind it. */
  async findWithNova(projectId: string, input: NovaFindInput): Promise<NovaFound> {
    const ratio = parseScale(input.scale);
    if (!ratio)
      problem(422, 'takeoff.scale_missing', 'Set the sheet scale before asking Nova to measure.');
    const spots: Array<{ place: string; confidence: number; points: Array<[number, number]> }> = [
      { place: 'Living', confidence: 0.97, points: [[0.2, 0.3]] },
      { place: 'Living', confidence: 0.93, points: [[0.28, 0.52]] },
      { place: 'Kitchen', confidence: 0.91, points: [[0.55, 0.3]] },
      { place: 'Bed 1', confidence: 0.71, points: [[0.82, 0.46]] },
      { place: 'Study', confidence: 0.52, points: [[0.74, 0.8]] },
    ];
    const shape = (pts: Array<[number, number]>, i: number) => {
      const [x = 0, y = 0] = pts[0]!;
      if (input.kind === 'count') return { kind: 'count' as const, points: [{ x, y }] };
      if (input.kind === 'length')
        return {
          kind: 'length' as const,
          points: [
            { x, y },
            { x: x + 0.12, y },
          ],
        };
      return {
        kind: 'area' as const,
        outer: [
          { x, y },
          { x: x + 0.1, y },
          { x: x + 0.1, y: y + 0.08 + i * 0.001 },
          { x, y: y + 0.08 },
        ],
        holes: [],
      };
    };
    const marks = spots.map((spot, i): TakeoffMeasurement => {
      const geometry = shape(spot.points, i);
      const unit = UNIT_FOR_KIND[geometry.kind];
      return {
        id: mockId('tko'),
        revisionId: input.revisionId,
        sheetNo: '1',
        kind: geometry.kind,
        geometry,
        quantity: roundQuantity(takeoffQuantity(geometry, A1, ratio), unit),
        unit,
        scaleUsed: input.scale,
        scaleConfirmed: input.scaleConfirmed,
        source: 'assisted',
        confidence: spot.confidence,
        confirmed: false,
        rejected: false,
        raster: false,
        label: `${input.trade ? `${input.trade}: ` : ''}${input.what} · ${spot.place}`,
        trade: input.trade,
        packageId: null,
        supersededByRevisionId: null,
        createdBy: 'Nova',
        createdAt: nowIso(),
      };
    });
    stores.get(projectId).rows.push(...marks);
    return delay({ marks, caveat: null, dropped: 0, scanned: false });
  },

  async accept(projectId: string, id: string): Promise<TakeoffMeasurement> {
    const row = stores.get(projectId).rows.find((m) => m.id === id);
    if (!row) problem(404, 'not_found', "We couldn't find that measurement.");
    Object.assign(row, { confirmed: true, rejected: false });
    return delay(row);
  },

  async reject(projectId: string, id: string): Promise<TakeoffMeasurement> {
    const row = stores.get(projectId).rows.find((m) => m.id === id);
    if (!row) problem(404, 'not_found', "We couldn't find that measurement.");
    if (row.source === 'manual')
      problem(422, 'takeoff.invalid', 'Only what Nova drew can be rejected.');
    Object.assign(row, { confirmed: false, rejected: true });
    return delay(row);
  },

  async acceptAbove(projectId: string, revisionId: string, minConfidence: number) {
    const rows = stores
      .get(projectId)
      .rows.filter(
        (m) =>
          m.revisionId === revisionId &&
          m.source !== 'manual' &&
          !m.confirmed &&
          !m.rejected &&
          (m.confidence ?? 0) >= minConfidence,
      );
    for (const m of rows) m.confirmed = true;
    return delay(rows.length);
  },

  async remove(projectId: string, id: string): Promise<void> {
    const s = stores.get(projectId);
    s.rows = s.rows.filter((m) => m.id !== id);
    return delay(undefined);
  },

  /** EST-AC11: send measured quantities to a tender package's scope. */
  /** Sends measurements to a tender package: one scope line per tag and unit (EST-US8, EST-AC11). */
  async sendToPackage(
    projectId: string,
    ids: readonly string[],
    packageId: string,
  ): Promise<number> {
    const rows = stores.get(projectId).rows.filter((row) => ids.includes(row.id));
    if (rows.some((row) => !row.scaleConfirmed)) {
      problem(
        422,
        'takeoff.scale_unconfirmed',
        'Confirm the scale before sending quantities to a package.',
      );
    }
    const totals = new Map<
      string,
      { tag: string; quantity: number; unit: TakeoffMeasurement['unit'] }
    >();
    for (const row of rows) {
      const tag = row.label || row.trade || 'Untagged';
      const key = `${tag}|${row.unit}`;
      const t = totals.get(key) ?? { tag, quantity: 0, unit: row.unit };
      t.quantity += row.quantity;
      totals.set(key, t);
    }
    await quotesSource.addTakeoffLines(projectId, packageId, [...totals.values()]);
    for (const row of rows) row.packageId = packageId;
    return delay(rows.length);
  },
};

export function resetTakeoffPreview() {
  stores.reset();
}

/** CSV export of measurements (EST-AC11): one row per measurement, quantities as stored. */
export function measurementsToCsv(
  rows: readonly TakeoffMeasurement[],
  sheetLabel: (m: TakeoffMeasurement) => string,
): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = [
    'Sheet',
    'Label',
    'Trade',
    'Kind',
    'Quantity',
    'Unit',
    'Scale',
    'Scale confirmed',
    'Source',
    'Measured by',
    'Measured at',
  ];
  const lines = rows.map((m) =>
    [
      sheetLabel(m),
      m.label,
      m.trade,
      m.kind,
      String(m.quantity),
      m.unit,
      m.scaleUsed,
      m.scaleConfirmed ? 'yes' : 'no',
      m.source,
      m.createdBy,
      m.createdAt,
    ]
      .map(esc)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n');
}
