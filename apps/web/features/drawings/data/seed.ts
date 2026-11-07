import { A1, artworkSegments, buildArtwork, type ArtworkSpec } from '../lib/artwork';
import { issuedForLabel } from '../lib/types';
import type {
  Discipline,
  DrawingMarkup,
  DrawingPin,
  DrawingRevision,
  DrawingSet,
  DrawingSetSummary,
  IssuedFor,
  SheetGeometry,
} from '../lib/types';

export interface SheetRow {
  id: string;
  sheetNumber: string;
  title: string;
  discipline: Discipline;
  area: string | null;
}

export interface DrawingsStore {
  sheets: SheetRow[];
  revisions: DrawingRevision[];
  geometry: Map<string, SheetGeometry>;
  artwork: Map<string, ArtworkSpec>;
  pins: Map<string, DrawingPin[]>;
  markups: DrawingMarkup[];
  sets: DrawingSet[];
  /** Published issues, one per issue date. */
  setMeta: DrawingSetSummary[];
}

interface RevSeed {
  id: string;
  rev: string;
  issuedFor: IssuedFor;
  date: string;
  variant: number;
  scaleDetected: string | null;
  scaleConfirmed?: string;
  scaleConflict?: string;
  raster?: boolean;
}

const SHEETS: Array<SheetRow & { revs: RevSeed[] }> = [
  {
    id: 'sht_a101',
    sheetNumber: 'A-101',
    title: 'Ground floor plan',
    discipline: 'A',
    area: 'Ground',
    revs: [
      {
        id: 'rev_a101_a',
        rev: 'A',
        issuedFor: 'for_tender',
        date: '2026-06-12',
        variant: 0,
        scaleDetected: '1:100',
        scaleConfirmed: '1:100',
      },
      {
        id: 'rev_a101_b',
        rev: 'B',
        issuedFor: 'for_construction',
        date: '2026-08-04',
        variant: 1,
        scaleDetected: '1:100',
        scaleConfirmed: '1:100',
      },
      {
        id: 'rev_a101_c',
        rev: 'C',
        issuedFor: 'for_construction',
        date: '2026-09-22',
        variant: 2,
        scaleDetected: '1:100',
      },
    ],
  },
  {
    id: 'sht_a102',
    sheetNumber: 'A-102',
    title: 'Level 1 floor plan',
    discipline: 'A',
    area: 'Level 1',
    revs: [
      // Title block says 1:100 but the dimension check reads 1:50: measuring is blocked until someone sets it.
      {
        id: 'rev_a102_b',
        rev: 'B',
        issuedFor: 'for_construction',
        date: '2026-09-22',
        variant: 1,
        scaleDetected: '1:100',
        scaleConflict: 'Title block says 1:100, but the dimensions on the sheet measure as 1:50.',
      },
    ],
  },
  {
    id: 'sht_s201',
    sheetNumber: 'S-201',
    title: 'Ground slab set-out',
    discipline: 'S',
    area: 'Ground',
    // No scale in the title block: the viewer prompts to calibrate from a known dimension.
    revs: [
      {
        id: 'rev_s201_1',
        rev: '1',
        issuedFor: 'for_construction',
        date: '2026-09-02',
        variant: 1,
        scaleDetected: null,
      },
    ],
  },
  {
    id: 'sht_e301',
    sheetNumber: 'E-301',
    title: 'Ground floor lighting layout',
    discipline: 'E',
    area: 'Ground',
    // Scanned sheet: no vector geometry, so no snapping.
    revs: [
      {
        id: 'rev_e301_a',
        rev: 'A',
        issuedFor: 'for_approval',
        date: '2026-09-15',
        variant: 2,
        scaleDetected: '1:100',
        raster: true,
      },
    ],
  },
  {
    id: 'sht_hy401',
    sheetNumber: 'HY-401',
    title: 'Hydraulic services ground floor',
    discipline: 'HY',
    area: 'Ground',
    revs: [
      {
        id: 'rev_hy401_p1',
        rev: 'P1',
        issuedFor: 'preliminary',
        date: '2026-07-30',
        variant: 1,
        scaleDetected: '1:100',
      },
    ],
  },
];

export function seedDrawings(): DrawingsStore {
  const revisions: DrawingRevision[] = [];
  const geometry = new Map<string, SheetGeometry>();
  const artwork = new Map<string, ArtworkSpec>();
  for (const sheet of SHEETS) {
    sheet.revs.forEach((r, i) => {
      const next = sheet.revs[i + 1];
      revisions.push({
        id: r.id,
        sheetId: sheet.id,
        setId: `set_${r.date}`,
        rev: r.rev,
        status: next ? 'superseded' : 'current',
        issuedFor: r.issuedFor,
        drawingDate: r.date,
        supersededAt: next ? `${next.date}T01:00:00Z` : null,
        supersededByRevisionId: next?.id ?? null,
        supersededByRev: next?.rev ?? null,
        widthMm: A1.widthMm,
        heightMm: A1.heightMm,
        fileId: null,
        pageIndex: 0,
        createdAt: `${r.date}T00:30:00Z`,
      });
      const spec: ArtworkSpec = {
        sheetNumber: sheet.sheetNumber,
        title: sheet.title,
        rev: r.rev,
        scale: r.scaleDetected,
        variant: r.variant,
        raster: r.raster ?? false,
      };
      artwork.set(r.id, spec);
      geometry.set(r.id, {
        revisionId: r.id,
        sheetNo: '1',
        units: 'mm',
        scaleDetected: r.scaleDetected,
        scaleConfirmed: r.scaleConfirmed ?? null,
        scaleConfirmedBy: r.scaleConfirmed ? 'Dana Okafor' : null,
        scaleConfirmedAt: r.scaleConfirmed ? `${r.date}T03:00:00Z` : null,
        scaleConflict: r.scaleConflict ?? null,
        hasVector: !r.raster,
        segments: r.raster ? [] : artworkSegments(buildArtwork(spec)),
      });
    });
  }

  const pins = new Map<string, DrawingPin[]>([
    [
      'rev_a101_c',
      [
        {
          id: 'pin_1',
          entityType: 'rfi',
          entityId: 'rfi_003',
          label: 'RFI-003',
          title: 'Bin store door swing',
          status: 'open',
          x: 510 / 841,
          y: 330 / 594,
          checkLocation: false,
        },
        {
          id: 'pin_2',
          entityType: 'defect',
          entityId: 'dft_0002',
          label: 'DEF-0002',
          title: 'Chipped floor tile at lobby entry',
          status: 'open',
          x: 300 / 841,
          y: 430 / 594,
          checkLocation: true,
        },
        {
          id: 'pin_3',
          entityType: 'defect',
          entityId: 'dft_0001',
          label: 'DEF-0001',
          title: 'Paint touch-up, retail 1 east wall',
          status: 'ready_for_review',
          x: 225 / 841,
          y: 150 / 594,
          checkLocation: false,
        },
      ],
    ],
    [
      'rev_a101_b',
      [
        {
          id: 'pin_4',
          entityType: 'defect',
          entityId: 'dft_0002',
          label: 'DEF-0002',
          title: 'Chipped floor tile at lobby entry',
          status: 'open',
          x: 300 / 841,
          y: 440 / 594,
          checkLocation: false,
        },
      ],
    ],
    [
      'rev_s201_1',
      [
        {
          id: 'pin_5',
          entityType: 'rfi',
          entityId: 'rfi_001',
          label: 'RFI-001',
          title: 'Slab edge set-out at grid C',
          status: 'closed',
          x: 240 / 841,
          y: 120 / 594,
          checkLocation: false,
        },
      ],
    ],
  ]);

  const addDays = (date: string, n: number) =>
    new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const setMeta: DrawingSetSummary[] = [...new Set(revisions.map((r) => r.setId))].map((id) => {
    const date = id.replace('set_', '');
    const issuedFor = revisions.find((r) => r.setId === id)?.issuedFor ?? null;
    return {
      id,
      name: `${issuedForLabel(issuedFor)}, ${date}`,
      status: 'published' as const,
      issuedDate: date,
      receivedDate: addDays(date, 1),
    };
  });

  const markups: DrawingMarkup[] = [
    {
      id: 'mku_1',
      revisionId: 'rev_a101_c',
      ownerId: 'usr_pm',
      ownerName: 'Dana Okafor',
      ownerCompanyId: 'cmp_builder',
      visibility: 'project',
      shape: {
        kind: 'cloud',
        from: { x: 430 / 841, y: 270 / 594 },
        to: { x: 590 / 841, y: 450 / 594 },
      },
      createdAt: '2026-09-23T02:00:00Z',
      copiedFromId: null,
      version: null,
    },
    {
      id: 'mku_2',
      revisionId: 'rev_a101_c',
      ownerId: 'usr_pm',
      ownerName: 'Dana Okafor',
      ownerCompanyId: 'cmp_builder',
      visibility: 'project',
      shape: { kind: 'text', at: { x: 445 / 841, y: 285 / 594 }, text: 'New bike store, Rev C' },
      createdAt: '2026-09-23T02:01:00Z',
      copiedFromId: null,
      version: null,
    },
  ];

  return {
    sheets: SHEETS.map(({ revs: _revs, ...s }) => s),
    revisions,
    geometry,
    artwork,
    pins,
    markups,
    sets: [],
    setMeta,
  };
}
