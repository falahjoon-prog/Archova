import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { createTakeoffApi, fromApiGeometry, splitTag, toApiGeometry } =
  await import('../data/takeoff-api');
const { resetProjectPeople } = await import('@/shared/lib/people');

const P = '/v1/orgs/{orgId}/projects/{projectId}/takeoff-measurements';
const ONE = `${P}/{measurementId}`;
const PKG = '/v1/orgs/{orgId}/projects/{projectId}/tender-packages/{packageId}';
const GEOMETRY =
  '/v1/orgs/{orgId}/projects/{projectId}/drawing-revisions/{drawingRevisionId}/geometry';
const source = createTakeoffApi('org_1');

const apiMeasurement = (over: Record<string, unknown> = {}) => ({
  id: 'tkm_1',
  revisionId: 'drv_c',
  label: 'Floor finishes: Retail 1 floor',
  kind: 'area',
  geometry: {
    type: 'polygon',
    points: [
      [0.1, 0.1],
      [0.4, 0.1],
      [0.4, 0.5],
    ],
  },
  quantity: '42.500',
  unit: 'm2',
  source: 'manual',
  confidence: null,
  packageId: null,
  scopeKey: null,
  confirmedBy: 'usr_dana',
  confirmedAt: '2026-10-30T00:00:00Z',
  createdAt: '2026-10-30T00:00:00Z',
  updatedAt: '2026-10-30T00:00:00Z',
  version: 2,
  ...over,
});

beforeEach(() => {
  fake.reset();
  resetProjectPeople();
  fake.on('GET', '/v1/orgs/{orgId}/projects/{projectId}/members', () => ({
    data: [{ userId: 'usr_dana', name: 'Dana Okafor', companyId: 'cmp_b', status: 'active' }],
    nextCursor: null,
  }));
  fake.on('GET', GEOMETRY, () => ({
    revisionId: 'drv_c',
    status: 'ready',
    scaleDetected: 100,
    scaleConfirmed: 100,
    scaleConfirmedBy: 'usr_dana',
    scaleConfirmedAt: '2026-10-30T00:00:00Z',
    extractedAt: null,
    version: 1,
  }));
});

describe('geometry and tags', () => {
  it('round-trips each shape, including an area’s cut-outs', () => {
    const area = {
      kind: 'area' as const,
      outer: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      holes: [
        [
          { x: 0.1, y: 0.1 },
          { x: 0.2, y: 0.1 },
          { x: 0.2, y: 0.2 },
        ],
      ],
    };
    expect(toApiGeometry(area)).toEqual({
      type: 'polygon',
      points: [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
      holes: [
        [
          [0.1, 0.1],
          [0.2, 0.1],
          [0.2, 0.2],
        ],
      ],
    });
    expect(fromApiGeometry('area', toApiGeometry(area))).toEqual(area);
    const wall = {
      kind: 'length' as const,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    };
    expect(toApiGeometry(wall).type).toBe('polyline');
    expect(fromApiGeometry('length', toApiGeometry(wall))).toEqual(wall);
    const doors = { kind: 'count' as const, points: [{ x: 0.3, y: 0.3 }] };
    expect(toApiGeometry(doors).type).toBe('points');
    expect(toApiGeometry({ ...area, holes: [] })).not.toHaveProperty('holes');
  });

  it('keeps the trade in the label and splits it again', () => {
    expect(splitTag('Painting: Level 1 walls')).toEqual({
      trade: 'Painting',
      label: 'Level 1 walls',
    });
    expect(splitTag('Level 1 walls')).toEqual({ trade: '', label: 'Level 1 walls' });
    expect(splitTag('Mystery: walls')).toEqual({ trade: '', label: 'Mystery: walls' });
  });
});

describe('takeoff measurements', () => {
  it('lists a revision’s measurements oldest first with the revision’s confirmed scale', async () => {
    fake.on('GET', P, () => ({
      data: [
        apiMeasurement({
          id: 'tkm_2',
          label: 'Door D1',
          kind: 'count',
          unit: 'ea',
          quantity: '3.000',
          geometry: { type: 'points', points: [[0.1, 0.2]] },
        }),
        apiMeasurement(),
      ],
      nextCursor: null,
    }));
    const rows = await source.list('prj_1', { revisionIds: ['drv_c'] });
    expect(fake.callsTo('GET', P)[0]!.init.params!.query).toMatchObject({ revisionId: 'drv_c' });
    expect(rows.map((r) => r.id)).toEqual(['tkm_1', 'tkm_2']);
    expect(rows[0]).toMatchObject({
      label: 'Retail 1 floor',
      trade: 'Floor finishes',
      quantity: 42.5,
      unit: 'm2',
      scaleUsed: '1:100',
      scaleConfirmed: true,
      createdBy: 'Dana Okafor',
    });
  });

  it('saves a measurement with the quantity worked out from the scale', async () => {
    fake.on('POST', P, (init) => apiMeasurement({ label: (init.body as { label: string }).label }));
    const [saved] = await source.createMany(
      'prj_1',
      {
        items: [
          {
            revisionId: 'drv_c',
            sheetNo: '1',
            label: 'Grid 3 partition',
            trade: 'Plasterboard and ceilings',
            raster: false,
            geometry: {
              kind: 'length',
              points: [
                { x: 0, y: 0 },
                { x: 0.5, y: 0 },
              ],
            },
          },
        ],
        scale: '1:100',
        scaleConfirmed: true,
        size: { widthMm: 841, heightMm: 594 },
      },
      { name: 'Dana Okafor' },
    );
    const body = fake.callsTo('POST', P)[0]!.init.body as Record<string, unknown>;
    expect(body).toMatchObject({
      revisionId: 'drv_c',
      label: 'Plasterboard and ceilings: Grid 3 partition',
      kind: 'length',
      unit: 'm',
      quantity: '42.050',
      source: 'manual',
    });
    expect(saved!.trade).toBe('Plasterboard and ceilings');
  });

  it('removes a measurement', async () => {
    fake.on('DELETE', ONE, () => undefined);
    await source.remove('prj_1', 'tkm_1');
    expect(fake.callsTo('DELETE', ONE)).toHaveLength(1);
  });

  it('sends measurements to a package as scope lines, one per tag and unit', async () => {
    const rows: Record<string, ReturnType<typeof apiMeasurement>> = {
      tkm_1: apiMeasurement({ id: 'tkm_1', label: 'Retail floor', quantity: '40.000' }),
      tkm_2: apiMeasurement({ id: 'tkm_2', label: 'Retail floor', quantity: '2.500' }),
      tkm_3: apiMeasurement({
        id: 'tkm_3',
        label: 'Door D1',
        kind: 'count',
        unit: 'ea',
        quantity: '3.000',
      }),
    };
    fake.on('GET', ONE, (init) => rows[init.params!.path!.measurementId!]);
    fake.on('GET', PKG, () => ({
      version: 6,
      scope: [
        {
          key: 'tk_door_d1_ea',
          description: 'Door D1',
          quantity: '2',
          unit: 'ea',
          source: 'takeoff',
        },
      ],
    }));
    fake.on('PATCH', PKG, () => ({}));
    fake.on('PATCH', ONE, () => apiMeasurement());
    const n = await source.sendToPackage('prj_1', ['tkm_1', 'tkm_2', 'tkm_3'], 'tpk_1');
    expect(n).toBe(3);
    const [pkg] = fake.callsTo('PATCH', PKG);
    expect(pkg!.init.params!.header).toEqual({ 'If-Match': '"6"' });
    expect(pkg!.init.body).toEqual({
      scope: [
        {
          key: 'tk_door_d1_ea',
          description: 'Door D1',
          quantity: '5',
          unit: 'ea',
          source: 'takeoff',
        },
        {
          key: 'tk_retail_floor_m2',
          description: 'Retail floor',
          quantity: '42.500',
          unit: 'm²',
          source: 'takeoff',
        },
      ],
    });
    const links = fake.callsTo('PATCH', ONE).map((c) => c.init.body);
    expect(links).toEqual([
      { packageId: 'tpk_1', scopeKey: 'tk_retail_floor_m2' },
      { packageId: 'tpk_1', scopeKey: 'tk_retail_floor_m2' },
      { packageId: 'tpk_1', scopeKey: 'tk_door_d1_ea' },
    ]);
  });

  it('has Nova find items and saves them as marks waiting for a person, sized from the scale', async () => {
    fake.on('POST', '/v1/orgs/{orgId}/projects/{projectId}/ai/takeoff-detections', () => ({
      runId: 'air_1',
      revisionId: 'drv_c',
      kind: 'length',
      what: 'strip footings',
      scanned: false,
      caveat: null,
      dropped: 0,
      items: [
        {
          place: 'Grid A',
          confidence: 0.92,
          note: null,
          points: [
            { x: 0, y: 0 },
            { x: 0.5, y: 0 },
          ],
        },
      ],
    }));
    fake.on('POST', `${P}/batch`, (init) => ({
      data: (init.body as { items: Array<Record<string, unknown>> }).items.map((i, n) =>
        apiMeasurement({
          ...i,
          id: `tkm_n${n}`,
          source: 'assisted',
          confirmedBy: null,
          confirmedAt: null,
          rejectedBy: null,
          rejectedAt: null,
        }),
      ),
    }));
    const found = await source.findWithNova('prj_1', {
      revisionId: 'drv_c',
      kind: 'length',
      what: 'strip footings',
      trade: 'Concrete',
      scale: '1:100',
      scaleConfirmed: true,
      size: { widthMm: 841, heightMm: 594 },
    });
    // Nova is asked what to find, never for a quantity.
    expect(
      fake.callsTo('POST', '/v1/orgs/{orgId}/projects/{projectId}/ai/takeoff-detections')[0]!.init
        .body,
    ).toEqual({ revisionId: 'drv_c', target: { kind: 'length', what: 'strip footings' } });
    const saved = fake.callsTo('POST', `${P}/batch`)[0]!.init.body as {
      items: Array<Record<string, unknown>>;
    };
    expect(saved.items[0]).toMatchObject({
      label: 'Concrete: strip footings · Grid A',
      kind: 'length',
      unit: 'm',
      quantity: '42.050',
      confidence: 0.92,
    });
    expect(found.marks[0]).toMatchObject({
      source: 'assisted',
      confirmed: false,
      rejected: false,
      createdBy: 'Nova',
    });
  });

  it('accepts and rejects marks one at a time and by confidence', async () => {
    fake.on('GET', ONE, () => apiMeasurement({ source: 'assisted', version: 3 }));
    fake.on('POST', `${ONE}/confirm`, () => apiMeasurement({ source: 'assisted', version: 4 }));
    fake.on('POST', `${ONE}/reject`, () =>
      apiMeasurement({
        source: 'assisted',
        confirmedBy: null,
        confirmedAt: null,
        rejectedBy: 'usr_dana',
        rejectedAt: '2026-10-30T00:00:00Z',
      }),
    );
    fake.on('POST', `${P}/confirm-batch`, () => ({ data: [apiMeasurement(), apiMeasurement()] }));

    expect((await source.accept('prj_1', 'tkm_1')).confirmed).toBe(true);
    expect(fake.callsTo('POST', `${ONE}/confirm`)[0]!.init.params!.header).toEqual({
      'If-Match': '"3"',
    });
    expect(await source.reject('prj_1', 'tkm_1')).toMatchObject({
      rejected: true,
      confirmed: false,
    });
    expect(await source.acceptAbove('prj_1', 'drv_c', 0.9)).toBe(2);
    expect(fake.callsTo('POST', `${P}/confirm-batch`)[0]!.init.body).toEqual({
      revisionId: 'drv_c',
      minConfidence: 0.9,
    });
  });
});
