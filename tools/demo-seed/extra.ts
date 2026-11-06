// More sample data for the demo tenant: ten records of each major kind, through the same public API the browser
// uses. Runs after the base seed (seed.ts). Every step tops its list up to ten and skips when it is already
// there, so re-runs don't duplicate; a step that fails logs a warning and the rest carry on. Sample data only.
import { addDays, type LocalDate, localDateOf } from '@archova/time';
import { makePdf } from './pdf';
import { Session } from './session';

export interface Api {
  etag: string | null;
  call<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    extra?: Record<string, string>,
  ): Promise<{ status: number; json: T }>;
  ok<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    extra?: Record<string, string>,
  ): Promise<T>;
}

export interface ExtraContext {
  s: Api;
  /** `/v1/orgs/<id>` */
  org: string;
  /** Projects in the order seeded; the first active one gets the ten-of-everything treatment. */
  projects: Array<{ id: string; name: string; status: string; timezone: string }>;
  company: Record<string, string>;
  userId: string;
  /** The app origin and the demo password, for signing up the sample colleagues. */
  origin: string;
  password: string;
  /** Uploads a PDF for a project (seed.ts), returning the file id. */
  upload: (
    projectId: string,
    module: string,
    filename: string,
    bytes: Uint8Array,
  ) => Promise<string>;
  /** The drawing sheets to give a project that has none. */
  sheets: Array<{ number: string; title: string; discipline: string }>;
}

const TARGET = 10;
const money = (n: number) => n.toFixed(2);

async function step(name: string, fn: () => Promise<string | void>) {
  try {
    const note = await fn();
    console.log(`Extra: ${name}${note ? ` (${note})` : ''}`);
  } catch (e) {
    console.warn(`Extra: ${name} failed: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Sample content
// ---------------------------------------------------------------------------------------------------------------

const EXTRA_COMPANIES = [
  { name: 'Harbourside Steel Fabrication', type: 'subcontractor', trades: ['Structural steel'] },
  { name: 'Bayview Roofing and Cladding', type: 'subcontractor', trades: ['Roofing', 'Cladding'] },
  { name: 'Eastern Glazing Systems', type: 'subcontractor', trades: ['Glazing', 'Aluminium'] },
  { name: 'Metro Building Supplies', type: 'supplier', trades: ['Timber', 'Hardware'] },
  { name: 'Allied Fire Services', type: 'subcontractor', trades: ['Fire protection'] },
  { name: 'Summit Lift Services', type: 'subcontractor', trades: ['Vertical transport'] },
] as const;

const EXTRA_PROJECTS = [
  [
    'Bondi Junction Medical Centre',
    'HL-2403',
    'active',
    'NSW',
    'Australia/Sydney',
    'Bondi Junction',
    '2022',
    -33.8914,
    151.2501,
  ],
  [
    'Newstead Apartments Stage 2',
    'HL-2404',
    'active',
    'QLD',
    'Australia/Brisbane',
    'Newstead',
    '4006',
    -27.4505,
    153.0452,
  ],
  [
    'Southbank Office Refurbishment',
    'HL-2405',
    'active',
    'VIC',
    'Australia/Melbourne',
    'Southbank',
    '3006',
    -37.8226,
    144.9646,
  ],
  [
    'Parramatta Community Hub',
    'HL-2406',
    'tender',
    'NSW',
    'Australia/Sydney',
    'Parramatta',
    '2150',
    -33.8151,
    151.0011,
  ],
  [
    'Surry Hills Warehouse Conversion',
    'HL-2408',
    'active',
    'NSW',
    'Australia/Sydney',
    'Surry Hills',
    '2010',
    -33.8845,
    151.2107,
  ],
  [
    'West End Childcare Centre',
    'HL-2409',
    'tender',
    'QLD',
    'Australia/Brisbane',
    'West End',
    '4101',
    -27.4817,
    153.0107,
  ],
  [
    'Richmond Retail Fit-out',
    'HL-2410',
    'closed',
    'VIC',
    'Australia/Melbourne',
    'Richmond',
    '3121',
    -37.8183,
    144.9988,
  ],
] as const;

const RFIS = [
  [
    'Slab edge set-down at balcony doors',
    'Drawing S-101 shows a 50 mm set-down but A-301 shows 30 mm at the balcony door thresholds. Which governs?',
  ],
  [
    'Fire-rated door schedule discrepancy',
    'The door schedule lists FRL -/60/30 for D12 but the fire engineer report requires -/120/30. Please confirm.',
  ],
  [
    'Hydraulic riser location clash',
    'The hydraulic riser sits inside the lift shaft wall on H-101. Please advise a relocated riser position.',
  ],
  [
    'Brick type at the street facade',
    'The specification names two face brick types for the street elevation. Please confirm the colour and bond.',
  ],
  [
    'Retaining wall drainage outlet',
    'There is no stormwater outlet shown for the rear retaining wall subsoil drain. Confirm the connection point.',
  ],
  [
    'Window head height at Level 1',
    'Elevation A-201 and the window schedule differ by 100 mm at the Level 1 window heads. Please confirm.',
  ],
  [
    'Switchboard room ventilation',
    'E-101 shows the main switchboard in a room with no ventilation. Please confirm the required air changes.',
  ],
  [
    'Waterproofing upturn height',
    'Confirm the waterproofing membrane upturn at the balcony walls: 100 mm or 150 mm above finished floor level.',
  ],
  [
    'Handrail fixing detail at stairs',
    'Please issue the handrail post fixing detail to the stair stringer; none is included in the structural set.',
  ],
  [
    'Stormwater pit lid rating',
    'Confirm the load rating of the stormwater pit lids in the driveway crossover (Class C or D).',
  ],
] as const;

const SUBMITTALS = [
  ['Reinforcement shop drawings, Level 1 slab', 'shop_drawing', '03 30 00 Cast-in-place concrete'],
  ['Face brick sample panel', 'sample', '04 21 00 Clay unit masonry'],
  ['Aluminium window frames product data', 'product_data', '08 51 13 Aluminium windows'],
  ['Fire door certificates', 'certificate', '08 11 13 Hollow metal doors'],
  ['Waterproofing membrane data sheet', 'product_data', '07 13 00 Sheet waterproofing'],
  ['Structural steel connection details', 'shop_drawing', '05 12 00 Structural steel'],
  ['Kitchen joinery mock-up', 'mock_up', '06 40 00 Architectural woodwork'],
  ['Hydraulic pump selection', 'product_data', '22 11 23 Domestic water pumps'],
  ['Floor tile samples', 'sample', '09 30 00 Tiling'],
  ['Switchboard shop drawings', 'shop_drawing', '26 24 16 Panelboards'],
] as const;

const DEFECTS = [
  ['Cracked tile in bathroom 2', 'medium', 'Finishes', 'Tiling'],
  ['Paint overspray on window glass', 'low', 'Finishes', 'Painting'],
  ['Door will not latch, unit 4', 'medium', 'Joinery', 'Carpentry'],
  ['Water stain on ceiling below balcony', 'high', 'Waterproofing', 'Waterproofing'],
  ['Skirting gap at stair landing', 'low', 'Joinery', 'Carpentry'],
  ['Exposed reinforcement at slab edge', 'critical', 'Structure', 'Concrete'],
  ['GPO not flush with wall plate', 'low', 'Electrical', 'Electrical'],
  ['Tap leaking at kitchen sink', 'medium', 'Plumbing', 'Plumbing'],
  ['Window seal gap on north elevation', 'high', 'Glazing', 'Glazing'],
  ['Handrail wobbles on stair 1', 'high', 'Safety', 'Metalwork'],
] as const;

const INCIDENTS = [
  [
    'Near miss: unsecured plank fell from scaffold',
    'near_miss',
    'high',
    'Scaffold, north elevation',
  ],
  ['Worker cut hand on formwork wire', 'injury', 'low', 'Level 1 slab'],
  ['Excavator contacted shed fence', 'property_damage', 'medium', 'Site boundary, east'],
  ['Diesel spill from generator', 'environmental', 'medium', 'Compound'],
  ['Near miss: reversing truck, no spotter', 'near_miss', 'high', 'Site entry'],
  ['Slip on wet ramp, no injury', 'near_miss', 'low', 'Basement ramp'],
  ['Worker struck by swinging door', 'injury', 'low', 'Level 1 corridor'],
  ['Unplanned power outage, crane stopped', 'dangerous_occurrence', 'medium', 'Crane pad'],
  ['Dust complaint from neighbour', 'environmental', 'low', 'Site boundary, west'],
  ['Near miss: dropped tool from level 2', 'near_miss', 'medium', 'Level 2 deck'],
] as const;

const OBSERVATIONS = [
  ['safety', 'Edge protection missing at stair void', 'Level 1', 'high'],
  ['safety', 'Extension leads across walkway', 'Level 1 corridor', 'medium'],
  ['quality', 'Rebar cover looks short at slab edge', 'Level 1 slab', 'high'],
  ['environmental', 'Sediment fence damaged after rain', 'Site boundary, south', 'medium'],
  ['safety', 'Fire extinguisher missing in site shed', 'Site shed', 'low'],
  ['quality', 'Brick coursing out of line', 'North elevation', 'medium'],
  ['commercial', 'Extra scaffold requested without variation', 'West elevation', 'medium'],
  ['safety', 'Housekeeping: offcuts blocking egress', 'Level 2', 'medium'],
  ['quality', 'Waterproofing lapped less than 50 mm', 'Bathroom 3', 'high'],
  ['environmental', 'Concrete washout bay overflowing', 'Compound', 'medium'],
] as const;

const SWMS = [
  ['Working at heights', ['fall_2m'], 'Roof edge and scaffold work above two metres.'],
  ['Excavation and trenching', ['shaft_trench_tunnel'], 'Trenching for stormwater and services.'],
  ['Crane lifts', ['mobile_plant'], 'Tower crane and mobile crane lifts of materials.'],
  ['Hot works', ['chemical_fuel_refrigerant'], 'Welding and grinding near flammable materials.'],
  [
    'Demolition of internal walls',
    ['demolition_load_bearing'],
    'Removal of existing internal walls.',
  ],
  [
    'Live electrical testing',
    ['energised_electrical'],
    'Testing and commissioning of the main switchboard.',
  ],
  ['Formwork erection and stripping', ['fall_2m'], 'Slab formwork at Level 1 and Level 2.'],
  [
    'Mobile plant near workers',
    ['mobile_plant'],
    'Excavator and skid steer working near pedestrians.',
  ],
  [
    'Confined space: stormwater tank',
    ['confined_space'],
    'Inspection and cleaning of the detention tank.',
  ],
  ['Precast panel installation', ['tilt_up_precast'], 'Lifting and bracing of precast panels.'],
] as const;

const CORRESPONDENCE = [
  [
    'Notice of delay: wet weather',
    'Rain on 3 and 4 November stopped the slab pour. We claim one day extension of time.',
  ],
  [
    'Request for extension of time: design change',
    'The revised window schedule delayed ordering by 10 days.',
  ],
  [
    'Instruction to proceed: additional waterproofing',
    'Please proceed with the extra membrane layer at the balconies.',
  ],
  [
    'Notice of latent condition: rock in excavation',
    'Rock was found at 1.2 m below ground level in the north footing.',
  ],
  [
    'Site instruction: revised door hardware',
    'Use the lever handles in the updated hardware schedule.',
  ],
  [
    'Letter: practical completion inspection date',
    'We propose 14 days notice for the practical completion inspection.',
  ],
  [
    'Notice: access restriction to adjoining lane',
    'The council has closed the rear lane from 9 November.',
  ],
  [
    'Letter: Level 1 slab test results',
    'Concrete cylinder results at 7 days are attached for review.',
  ],
  [
    'Notice of dispute: variation valuation',
    'We do not agree with the valuation of variation 004.',
  ],
  [
    'Letter: client selections deadline',
    'Tile and fixture selections are required by 20 November.',
  ],
] as const;

const SERIES = [
  ['Weekly site coordination', 'site_coordination', 'Weekly'],
  ['Project control group', 'pcg', 'Monthly'],
  ['Design coordination', 'design_coordination', 'Fortnightly'],
  ['Safety committee', 'safety_committee', 'Monthly'],
  ['Subcontractor kick-off: concrete', 'custom', null],
  ['Client progress meeting', 'custom', 'Fortnightly'],
  ['Services coordination', 'design_coordination', 'Fortnightly'],
  ['Pre-start: facade', 'custom', null],
  ['Variation review', 'custom', 'Monthly'],
  ['Handover planning', 'custom', null],
] as const;

const COST_CODES = [
  ['01', 'Preliminaries', 180000],
  ['02', 'Demolition and earthworks', 95000],
  ['03', 'Concrete', 420000],
  ['04', 'Masonry', 210000],
  ['05', 'Structural steel', 165000],
  ['06', 'Carpentry and joinery', 240000],
  ['07', 'Roofing and waterproofing', 130000],
  ['08', 'Windows and doors', 185000],
  ['09', 'Finishes', 275000],
  ['22', 'Hydraulics', 150000],
] as const;

const EQUIPMENT = [
  ['Tower crane TC-1', 'EQ-001', 'Crane'],
  ['Excavator 8t', 'EQ-002', 'Excavator'],
  ['Skid steer loader', 'EQ-003', 'Loader'],
  ['Telehandler 4t', 'EQ-004', 'Telehandler'],
  ['Scissor lift 10m', 'EQ-005', 'Access'],
  ['Concrete pump boom', 'EQ-006', 'Pump'],
  ['Site generator 40 kVA', 'EQ-007', 'Generator'],
  ['Compactor roller', 'EQ-008', 'Compaction'],
  ['Mobile light tower', 'EQ-009', 'Lighting'],
  ['Material hoist', 'EQ-010', 'Hoist'],
] as const;

const SCHEDULES = [
  'Master programme',
  'Three-week look-ahead',
  'Structure and slabs',
  'Facade and envelope',
  'Services rough-in',
  'Internal fit-out',
  'External works',
  'Commissioning and handover',
  'Procurement programme',
  'Baseline (contract)',
] as const;

const ACTIVITIES = [
  ['Site establishment', 0, 10],
  ['Excavation and footings', 10, 35],
  ['Ground slab', 35, 50],
  ['Level 1 structure', 50, 90],
  ['Roof structure', 90, 120],
  ['Facade installation', 100, 170],
  ['Services rough-in', 110, 180],
  ['Internal linings', 170, 230],
  ['Fit-out and finishes', 230, 290],
  ['Practical completion', 300, 300],
] as const;

const INDUCTIONS = [
  'General site induction',
  'Visitor induction',
  'Crane and lifting induction',
  'Excavation induction',
  'Electrical works induction',
  'Facade and glazing induction',
  'Scaffold induction',
  'Hot works induction',
  'Delivery driver induction',
  'Out-of-hours work induction',
] as const;

const TENDERS = [
  ['Concrete and formwork', 'Concrete'],
  ['Structural steel', 'Structural steel'],
  ['Brickwork', 'Masonry'],
  ['Roofing and cladding', 'Roofing'],
  ['Windows and glazing', 'Glazing'],
  ['Hydraulic services', 'Plumbing'],
  ['Electrical services', 'Electrical'],
  ['Fire services', 'Fire protection'],
  ['Painting', 'Painting'],
  ['Landscaping', 'Landscaping'],
] as const;

const INDUCTION_SECTIONS = [
  [
    'who_and_access',
    'Who is on site and how to get in',
    'Sign in at the gate every day. Visitors must be escorted.',
  ],
  [
    'layout_and_amenities',
    'Site layout and amenities',
    'Amenities and the lunch shed are next to the site office. Walkways are marked in green.',
  ],
  [
    'emergencies_and_first_aid',
    'Emergencies and first aid',
    'The muster point is at the front gate. The first aid kit is in the site office.',
  ],
  [
    'site_hazards',
    'Site hazards',
    'Excavations, moving plant, work at height and live services are the main hazards.',
  ],
  [
    'high_risk_work_and_permits',
    'High risk work and permits',
    'A permit is needed for hot works, confined spaces and work near live services.',
  ],
  ['ppe', 'PPE', 'Hard hat, hi-vis, safety boots and eye protection are mandatory on site.'],
  ['site_rules', 'Site rules', 'No alcohol or drugs. Keep walkways clear. Report every hazard.'],
  [
    'incident_reporting',
    'Incident reporting',
    'Report every injury, near miss and hazard to the supervisor straight away.',
  ],
  [
    'consultation',
    'Consultation',
    'Raise safety concerns with your supervisor or the site safety representative.',
  ],
] as const;

const HEAD = ['Head contract', 'head'] as const;

// ---------------------------------------------------------------------------------------------------------------

export async function seedExtra(ctx: ExtraContext) {
  const { s, org, userId } = ctx;
  const primary = ctx.projects.find((p) => p.status === 'active');
  if (!primary) return;
  const pp = `${org}/projects/${primary.id}`;
  const today = localDateOf(new Date(), primary.timezone);
  const day = (n: number): LocalDate => addDays(today, n);

  /** How many records a list already holds, so a re-run tops up instead of duplicating. */
  const count = async (path: string): Promise<number> => {
    const r = await s.ok<{ data?: unknown[] }>('GET', path);
    return r.data?.length ?? 0;
  };
  /** Runs `make(i)` for the missing records of a list. */
  const topUp = async (
    listPath: string,
    make: (i: number) => Promise<unknown>,
    target = TARGET,
  ) => {
    const have = await count(listPath);
    for (let i = have; i < target; i++) await make(i);
    return `${Math.max(target - have, 0)} added, ${Math.min(have, target)} existing`;
  };

  await step('companies', async () => {
    const existing = await s.ok<{ data: Array<{ name: string }> }>('GET', `${org}/companies`);
    const names = new Set(existing.data.map((c) => c.name));
    let added = 0;
    for (const c of EXTRA_COMPANIES) {
      if (names.has(c.name)) continue;
      await s.ok('POST', `${org}/companies`, {
        name: c.name,
        type: c.type,
        trades: [...c.trades],
        email: `office@${c.name.toLowerCase().replace(/[^a-z]+/g, '')}.example.com`,
      });
      added++;
    }
    return `${added} added`;
  });

  // Drawings and specification books on every project that has none (the base seed only covers its own three
  // projects, so the extra ones, or a project from an earlier partial run, would show empty registers).
  await step('drawings and specifications on every project', async () => {
    const all = (
      await s.ok<{
        data: Array<{
          id: string;
          name: string;
          number?: string;
          status: string;
          startDate?: string;
        }>;
      }>('GET', `${org}/projects`)
    ).data;
    let drawings = 0;
    let books = 0;
    for (const p of all) {
      const base = `${org}/projects/${p.id}`;
      const date = p.startDate ?? day(-120);
      const sheetList = await s.ok<{ data?: unknown[] }>('GET', `${base}/drawings`);
      if (!sheetList.data?.length) {
        const set = await s.ok<{ id: string }>('POST', `${base}/drawing-sets`, {
          name: p.status === 'tender' ? 'Tender Issue' : 'Issued for Construction',
          issuedDate: date,
          receivedDate: date,
        });
        for (const sh of ctx.sheets) {
          const fileId = await ctx.upload(
            p.id,
            'drawings',
            `${sh.number}.pdf`,
            makePdf({ project: p.name, number: sh.number, title: sh.title, rev: 'A' }),
          );
          await s.ok('POST', `${base}/drawing-sets/${set.id}/revisions`, {
            sheetNumber: sh.number,
            title: sh.title,
            discipline: sh.discipline,
            rev: 'A',
            issuedFor: p.status === 'tender' ? 'for_tender' : 'for_construction',
            fileId,
            drawingDate: date,
          });
        }
        await s.ok('POST', `${base}/drawing-sets/${set.id}/publish`, { confirmNewSheets: true });
        drawings++;
      }
      const bookList = await s.ok<{ data?: unknown[] }>('GET', `${base}/spec-books`);
      if (!bookList.data?.length) {
        const sections = [
          ['01 10 00', 'Preliminaries and General Requirements', 'Division 01 General', 1, 12],
          ['03 30 00', 'Cast-in-place Concrete', 'Division 03 Concrete', 13, 30],
          ['05 12 00', 'Structural Steel Framing', 'Division 05 Metals', 31, 44],
          ['07 21 00', 'Thermal Insulation', 'Division 07 Thermal and Moisture', 45, 52],
          ['08 11 00', 'Doors and Frames', 'Division 08 Openings', 53, 64],
          ['09 29 00', 'Plasterboard Linings', 'Division 09 Finishes', 65, 78],
          ['21 13 00', 'Fire Sprinkler Systems', 'Division 21 Fire Suppression', 79, 90],
          ['22 00 00', 'Hydraulic Services', 'Division 22 Plumbing', 91, 106],
          ['26 05 00', 'Electrical Services', 'Division 26 Electrical', 107, 125],
        ] as const;
        const book = await s.ok<{ id: string }>('POST', `${base}/spec-books`, {
          name: `${p.name} Specification`,
          issuedDate: date,
        });
        await s.ok(
          'PUT',
          `${base}/spec-books/${book.id}/sections`,
          {
            sections: sections.map(([sectionNumber, title, division, pageFrom, pageTo]) => ({
              sectionNumber,
              title,
              division,
              pageFrom,
              pageTo,
              revision: 'A',
            })),
          },
          { 'if-match': s.etag ?? '' },
        );
        books++;
      }
    }
    return `${drawings} projects got drawings, ${books} got a specification book`;
  });

  // Subcontractor prequalification (flag subcontractor_prequalification): one published form, then a register
  // with a mix of qualified, expiring (within 30 days), pending and not-qualified companies.
  await step('prequalification', async () => {
    const flagOn = await s.call('GET', `${org}/prequal-templates`);
    if (flagOn.status === 404) return 'flag is off, skipped';
    if (flagOn.status >= 300) throw new Error(`prequal-templates -> ${flagOn.status}`);
    const templates = (
      flagOn.json as { data: Array<{ id: string; name: string; published: boolean }> }
    ).data;
    let template = templates.find(
      (t) => t.name === 'Subcontractor prequalification' && t.published,
    );
    if (!template) {
      const q = (
        id: string,
        section: string,
        prompt: string,
        type: 'yes_no' | 'number' | 'text',
        extra: Record<string, unknown> = {},
      ) => ({
        id,
        section,
        prompt,
        type,
        options: [],
        required: true,
        expect: null,
        points: 0,
        critical: false,
        ...extra,
      });
      const created = await s.ok<{ id: string }>('POST', `${org}/prequal-templates`, {
        name: 'Subcontractor prequalification',
        validityMonths: 12,
        questions: [
          q('abn', 'Company', 'Do you hold a current ABN and GST registration?', 'yes_no', {
            expect: 'yes',
            points: 10,
          }),
          q('licence', 'Company', 'Do you hold the contractor licence for your trade?', 'yes_no', {
            expect: 'yes',
            points: 20,
            critical: true,
          }),
          q(
            'insurance',
            'Insurance',
            'Is public liability cover current for at least $20M?',
            'yes_no',
            {
              expect: 'yes',
              points: 20,
              critical: true,
            },
          ),
          q('wc', 'Insurance', 'Is workers compensation insurance current?', 'yes_no', {
            expect: 'yes',
            points: 20,
            critical: true,
          }),
          q('ltifr', 'Safety', 'Lost-time injuries in the last 12 months', 'number', {
            points: 10,
          }),
          q('swms', 'Safety', 'Do you prepare a SWMS for every high-risk task?', 'yes_no', {
            expect: 'yes',
            points: 15,
          }),
          q('refs', 'Experience', 'Name two recent projects of similar size', 'text', {
            required: false,
            points: 5,
          }),
        ],
      });
      await s.ok(
        'POST',
        `${org}/prequal-templates/${created.id}/publish`,
        {},
        { 'if-match': s.etag ?? '' },
      );
      template = { id: created.id, name: 'Subcontractor prequalification', published: true };
    }
    const have = new Set(
      (
        await s.ok<{ data: Array<{ companyId: { id?: string } | string }> }>(
          'GET',
          `${org}/prequalifications`,
        )
      ).data.map((p) => (typeof p.companyId === 'string' ? p.companyId : p.companyId.id)),
    );
    const companies = (
      await s.ok<{ data: Array<{ id: string; name: string; type: string; trades: string[] }> }>(
        'GET',
        `${org}/companies`,
      )
    ).data.filter((c) => c.type === 'subcontractor');
    const good = { abn: true, licence: true, insurance: true, wc: true, ltifr: 0, swms: true };
    // The outcome per company, in order: qualified, expiring soon, pending, then a rejected one.
    const plan = [
      { to: 'approved', expires: day(240), answers: good },
      { to: 'approved', expires: day(11), answers: { ...good, ltifr: 1 } },
      { to: 'approved', expires: day(26), answers: good },
      { to: 'approved', expires: day(170), answers: { ...good, ltifr: 2 } },
      { to: 'submitted', answers: good },
      { to: 'submitted', answers: { ...good, wc: false } },
      { to: 'draft', answers: { abn: true, licence: true } },
      { to: 'rejected', answers: { ...good, insurance: false, swms: false } },
    ] as const;
    let added = 0;
    for (const c of companies) {
      const step = plan[added];
      if (!step) break;
      if (have.has(c.id)) continue;
      const created = await s.ok<{ id: string }>('POST', `${org}/prequalifications`, {
        companyId: c.id,
        templateId: template.id,
        trades: c.trades.slice(0, 3),
      });
      const at = `${org}/prequalifications/${created.id}`;
      await s.ok('PATCH', at, { answers: step.answers }, { 'if-match': s.etag ?? '' });
      added++;
      if (step.to === 'draft') continue;
      await s.ok('POST', `${at}/submit`, {}, { 'if-match': s.etag ?? '' });
      if (step.to === 'submitted') continue;
      if (step.to === 'rejected')
        await s.ok(
          'POST',
          `${at}/reject`,
          {
            note: 'Public liability cover is below the required limit. Resubmit with a current certificate.',
          },
          { 'if-match': s.etag ?? '' },
        );
      else
        await s.ok(
          'POST',
          `${at}/approve`,
          { note: 'Approved after document check.', expiresOn: step.expires },
          { 'if-match': s.etag ?? '' },
        );
    }
    return `${added} added`;
  });

  // Subcontractor compliance wallet (flag subcontractor_wallet): the demo builder's own insurance and licences,
  // self-declared so no files are needed.
  await step('compliance wallet', async () => {
    const r = await s.call('GET', `${org}/compliance-documents`);
    if (r.status === 404) return 'flag is off, skipped';
    if (r.status >= 300) throw new Error(`compliance-documents -> ${r.status}`);
    const existing = new Set(
      (r.json as { data: Array<{ title: string }> }).data.map((d) => d.title),
    );
    const docs = [
      {
        itemType: 'public_liability',
        title: 'Public liability $20M',
        insurer: 'Southern Mutual',
        limitCents: 2_000_000_000,
        number: 'PL-884201',
        expiresOn: day(180),
      },
      {
        itemType: 'workers_comp',
        title: 'Workers compensation',
        insurer: 'icare',
        number: 'WC-553917',
        expiresOn: day(20),
      },
      {
        itemType: 'contract_works',
        title: 'Contract works',
        insurer: 'Southern Mutual',
        number: 'CW-120554',
        expiresOn: day(300),
      },
      {
        itemType: 'contractor_licence',
        title: 'NSW builder licence',
        issuingState: 'NSW',
        number: 'BL-771203',
        expiresOn: day(400),
      },
    ] as const;
    let added = 0;
    for (const d of docs) {
      if (existing.has(d.title)) continue;
      await s.ok('POST', `${org}/compliance-documents`, {
        ...d,
        startsOn: day(-180),
        selfDeclared: true,
      });
      added++;
    }
    return `${added} added`;
  });

  await step('projects', async () => {
    const existing = await s.ok<{ data: Array<{ name: string }> }>('GET', `${org}/projects`);
    const names = new Set(existing.data.map((p) => p.name));
    let added = 0;
    for (const [
      name,
      number,
      status,
      state,
      timezone,
      suburb,
      postcode,
      lat,
      lng,
    ] of EXTRA_PROJECTS) {
      if (names.has(name)) continue;
      await s.ok('POST', `${org}/projects`, {
        name,
        number,
        status,
        state,
        timezone,
        address: { line1: `${10 + added} Sample Street`, suburb, state, postcode },
        siteLocation: { lat, lng },
        startDate: status === 'tender' ? '2027-02-01' : '2026-06-01',
        endDate: '2027-12-17',
      });
      added++;
    }
    return `${added} added`;
  });

  // One sample colleague per company (a real account each), invited to the project, so the companies count as on
  // the project and can be assignees, recipients and attendees.
  await step('project companies', async () => {
    const templates = (
      await s.ok<{ data: Array<{ id: string; name: string }> }>(
        'GET',
        `${org}/permission-templates`,
      )
    ).data;
    const template =
      templates.find((x) => /subcontract|member|standard/i.test(x.name)) ?? templates[0];
    if (!template) throw new Error('no permission templates');
    const existing = await s.ok<{ data: Array<{ companyId?: string | null }> }>(
      'GET',
      `${pp}/members`,
    );
    const have = new Set(existing.data.map((m) => m.companyId));
    let added = 0;
    for (const [key, id] of Object.entries(ctx.company)) {
      if (have.has(id)) continue;
      const email = `${key}@sample-${key}.example.com`;
      const other = new Session(ctx.origin);
      const su = await other.call('POST', '/v1/auth/signup', {
        email,
        password: ctx.password,
        name: `Sample ${key} contact`,
      });
      if (su.status >= 300 && su.status !== 409)
        console.warn(`Signing up ${email} -> ${su.status} ${JSON.stringify(su.json)}`);
      const r = await s.call('POST', `${pp}/members`, {
        email,
        companyId: id,
        permissionTemplateId: template.id,
      });
      if (r.status >= 300) console.warn(`Inviting ${key} -> ${r.status} ${JSON.stringify(r.json)}`);
      else added++;
    }
    return `${added} added`;
  });

  // Drawing revisions for pinning defects and RFIs.
  let revisionIds: string[] = [];
  await step('find drawings', async () => {
    const r = await s.ok<{
      data: Array<{
        id: string;
        currentRevision?: { id: string } | null;
        currentRevisionId?: string;
      }>;
    }>('GET', `${pp}/drawings`);
    revisionIds = r.data
      .map((d) => d.currentRevision?.id ?? d.currentRevisionId)
      .filter((x): x is string => Boolean(x));
    return `${revisionIds.length} sheets`;
  });
  const pin = (i: number) =>
    revisionIds.length
      ? {
          drawingRevisionId: revisionIds[i % revisionIds.length]!,
          x: 0.2 + ((i * 7) % 6) / 10,
          y: 0.25 + ((i * 3) % 5) / 10,
        }
      : undefined;

  await step('RFIs', () =>
    topUp(`${pp}/rfis`, async (i) => {
      const [subject, question] = RFIS[i % RFIS.length]!;
      const company = [ctx.company.arch, ctx.company.struct][i % 2];
      const rfi = await s.ok<{ rfi: { id: string } }>('POST', `${pp}/rfis`, {
        subject,
        question: `${question} Sample data only.`,
        receivedFromCompanyId: company,
        assigneeIds: [userId],
        dueDate: day(7 + i),
        costImpact: (['tbc', 'no', 'yes'] as const)[i % 3],
        scheduleImpactDays: i % 3 === 2 ? 3 : 0,
        ...(i % 2 === 0 && pin(i) ? { pin: pin(i) } : {}),
      });
      if (i % 3 !== 2)
        await s.call('POST', `${pp}/rfis/${rfi.rfi.id}/open`, {}, { 'if-match': s.etag ?? '' });
    }),
  );

  await step('submittals', () =>
    topUp(`${pp}/submittals`, async (i) => {
      const [title, type, specSection] = SUBMITTALS[i % SUBMITTALS.length]!;
      await s.ok('POST', `${pp}/submittals`, {
        title,
        type,
        specSection,
        numberLabel: `SUB-${String(i + 1).padStart(3, '0')}`,
        responsibleCompanyId: [ctx.company.conc, ctx.company.elec, ctx.company.hyd][i % 3],
        requiredOnSite: day(21 + i * 3),
        leadTimeDays: 10 + i,
        reviewDays: 10,
      });
    }),
  );

  await step('defects', async () => {
    if (!revisionIds.length) throw new Error('no drawings to pin defects on');
    return topUp(`${pp}/defects`, async (i) => {
      const [title, priority, category, trade] = DEFECTS[i % DEFECTS.length]!;
      await s.ok('POST', `${pp}/defects`, {
        title,
        priority,
        category,
        trade,
        stage: (['pre_pc', 'pre_pc', 'pc'] as const)[i % 3],
        assigneeCompanyId: [ctx.company.conc, ctx.company.elec, ctx.company.hyd][i % 3],
        dueDate: day(5 + i),
        pin: pin(i),
      });
    });
  });

  await step('incidents', () =>
    topUp(`${pp}/incidents`, async (i) => {
      const [title, type, severity, location] = INCIDENTS[i % INCIDENTS.length]!;
      const at = new Date(Date.now() - (i + 1) * 36 * 3600_000).toISOString();
      await s.ok('POST', `${pp}/incidents`, {
        title,
        type,
        severity,
        location,
        occurredAt: at,
        immediateActions:
          'Area made safe, supervisor notified, toolbox talk held. Sample data only.',
        people:
          type === 'injury'
            ? [
                {
                  personName: `Sample Worker ${i + 1}`,
                  companyId: ctx.company.conc,
                  role: 'injured',
                },
              ]
            : [
                {
                  personName: `Sample Witness ${i + 1}`,
                  companyId: ctx.company.elec,
                  role: 'witness',
                },
              ],
      });
    }),
  );

  await step('observations', () =>
    topUp(`${pp}/observations`, async (i) => {
      const [type, hazard, location, priority] = OBSERVATIONS[i % OBSERVATIONS.length]!;
      await s.ok('POST', `${pp}/observations`, {
        type,
        hazard,
        description: `${hazard}. Raised on a site walk. Sample data only.`,
        location,
        priority,
        assigneeCompanyId: [ctx.company.conc, ctx.company.elec, ctx.company.hyd][i % 3],
        dueDate: day(3 + i),
      });
    }),
  );

  await step('SWMS', () =>
    topUp(`${pp}/swms`, async (i) => {
      const [title, categories, description] = SWMS[i % SWMS.length]!;
      await s.ok('POST', `${pp}/swms`, {
        title,
        companyId: [ctx.company.conc, ctx.company.elec, ctx.company.hyd][i % 3],
        highRiskWorkCategories: [...categories],
        expiresOn: day(180),
        content: {
          workDescription: `${description} Sample data only.`,
          hazardsAndRisks: 'Falls, falling objects, plant movement, manual handling.',
          controlMeasures: [
            { level: 'eliminate', description: 'Prefabricate off site where practical.' },
            { level: 'engineer', description: 'Edge protection, exclusion zones and barriers.' },
            { level: 'administrative', description: 'Pre-start briefing and permits.' },
            {
              level: 'ppe',
              description: 'Hard hat, hi-vis, gloves, safety boots, eye protection.',
            },
          ],
          implementation: 'Supervisor checks the controls before each shift.',
          responsiblePeople: 'Site supervisor',
          reviewDate: day(90),
        },
      });
    }),
  );

  await step('correspondence', async () => {
    let types = (await s.ok<{ data: Array<{ id: string }> }>('GET', `${org}/correspondence-types`))
      .data;
    if (!types.length) {
      const templates = (
        await s.ok<{ data: Array<{ key: string }> }>('GET', `${org}/correspondence-templates`)
      ).data;
      for (const t of templates.slice(0, 3))
        await s.ok('POST', `${org}/correspondence-types`, { templateKey: t.key });
      types = (await s.ok<{ data: Array<{ id: string }> }>('GET', `${org}/correspondence-types`))
        .data;
    }
    if (!types.length) throw new Error('no correspondence types');
    return topUp(`${pp}/correspondence`, async (i) => {
      const [subject, body] = CORRESPONDENCE[i % CORRESPONDENCE.length]!;
      await s.ok('POST', `${pp}/correspondence`, {
        typeId: types[i % types.length]!.id,
        subject,
        body: `${body} Sample data only.`,
        fromCompanyId: ctx.company.client,
        toCompanyIds: [ctx.company.arch],
        responseRequired: i % 2 === 0,
        dueDate: day(10 + i),
        eventDate: day(-(i + 1)),
      });
    });
  });

  await step('meetings', () =>
    topUp(`${pp}/meeting-series`, async (i) => {
      const [name, template, cadence] = SERIES[i % SERIES.length]!;
      const series = await s.ok<{ id?: string; series?: { id: string } }>(
        'POST',
        `${pp}/meeting-series`,
        {
          name,
          template,
          cadence,
          defaultAttendees: [
            { name: 'Demo Builder', userId },
            { name: 'Coastline Architects', companyId: ctx.company.arch },
          ],
          agenda: [
            { title: 'Safety', internalOnly: false },
            { title: 'Progress and programme', internalOnly: false },
            { title: 'Open RFIs and submittals', internalOnly: false },
          ],
        },
      );
      const id = series.id ?? series.series?.id;
      await s.ok('POST', `${pp}/meeting-series/${id}/meetings`, {
        title: `${name} #1`,
        heldAt: new Date(Date.now() + (i - 4) * 86400_000).toISOString(),
        location: i % 2 ? 'Site office' : 'Video call',
      });
    }),
  );

  // Budget: cost codes, a budget line each, then commitments and direct costs against the lines.
  const lineIds: string[] = [];
  await step('cost codes and budget', async () => {
    const have = (
      await s.ok<{ data: Array<{ id: string; code: string }> }>('GET', `${pp}/cost-codes`)
    ).data;
    const byCode = new Map(have.map((c) => [c.code, c.id]));
    const b = await s.ok<{ id?: string; status?: string }>('GET', `${pp}/budget`);
    if (!b.id) await s.ok('POST', `${pp}/budget`, {});
    const codeIds: string[] = [];
    for (const [code, description] of COST_CODES.map(([c, d]) => [c, d] as const)) {
      let id = byCode.get(code);
      if (!id)
        id = (await s.ok<{ id: string }>('POST', `${pp}/cost-codes`, { code, description })).id;
      codeIds.push(id);
    }
    const lines = await s.ok<{
      lines?: Array<{ id: string; costCodeId: string }>;
      data?: Array<{ id: string; costCodeId: string }>;
    }>('GET', `${pp}/budget`);
    const existing = new Map((lines.data ?? lines.lines ?? []).map((l) => [l.costCodeId, l.id]));
    for (const [i, [, , amount]] of COST_CODES.entries()) {
      let id = existing.get(codeIds[i]!);
      if (!id)
        id = (
          await s.ok<{ id: string }>('POST', `${pp}/budget/lines`, {
            costCodeId: codeIds[i],
            original: money(amount),
          })
        ).id;
      lineIds.push(id);
    }
    return `${codeIds.length} codes, ${lineIds.length} lines`;
  });

  await step('commitments', async () => {
    if (!lineIds.length) throw new Error('no budget lines');
    const vendors = [ctx.company.conc, ctx.company.elec, ctx.company.hyd];
    return topUp(`${pp}/commitments`, async (i) => {
      await s.ok('POST', `${pp}/commitments`, {
        kind: i % 3 === 2 ? 'purchase_order' : 'subcontract',
        title: `${COST_CODES[i % COST_CODES.length]![1]} ${i % 3 === 2 ? 'purchase order' : 'subcontract'}`,
        vendorCompanyId: vendors[i % 3],
        lines: [
          {
            budgetLineId: lineIds[i % lineIds.length],
            description: `${COST_CODES[i % COST_CODES.length]![1]} works`,
            amount: money(COST_CODES[i % COST_CODES.length]![2] * 0.8),
          },
        ],
      });
    });
  });

  await step('direct costs', async () => {
    if (!lineIds.length) throw new Error('no budget lines');
    const categories = ['labour', 'materials', 'plant', 'fees', 'other'] as const;
    return topUp(`${pp}/direct-costs`, async (i) => {
      const amount = 2500 + i * 1375;
      await s.ok('POST', `${pp}/direct-costs`, {
        description: `${categories[i % categories.length]} for ${COST_CODES[i % COST_CODES.length]![1].toLowerCase()}`,
        budgetLineId: lineIds[i % lineIds.length],
        category: categories[i % categories.length],
        supplier: ['Metro Building Supplies', 'Sample Hire Co', 'Council fees', 'Readymix Co'][
          i % 4
        ],
        reference: `INV-${1000 + i}`,
        incurredOn: day(-(i + 2)),
        amount: money(amount),
        gst: money(amount / 10),
      });
    });
  });

  await step('contracts', () =>
    topUp(`${pp}/contracts`, async (i) => {
      const [title, kind] =
        i === 0 ? HEAD : ([`${COST_CODES[i]![1]} subcontract`, 'subcontract'] as const);
      const value = i === 0 ? 3_200_000 : COST_CODES[i]![2] * 0.9;
      await s.ok('POST', `${pp}/contracts`, {
        kind,
        title,
        payerCompanyId: i === 0 ? ctx.company.client : null,
        payeeCompanyId:
          i === 0 ? null : [ctx.company.conc, ctx.company.elec, ctx.company.hyd][i % 3],
        originalValue: money(value),
        retentionPct: '5.00',
        retentionCapPct: '5.00',
        sopaState: 'NSW',
        scheduleDays: 28,
        paymentDays: 10,
        sov: [
          { code: '1', description: 'Establishment and early works', value: money(value * 0.4) },
          { code: '2', description: 'Main works', value: money(value * 0.6) },
        ],
      });
    }),
  );

  await step('equipment', () =>
    topUp(`${pp}/equipment`, async (i) => {
      const [name, assetNumber, type] = EQUIPMENT[i % EQUIPMENT.length]!;
      await s.ok('POST', `${pp}/equipment`, { name, assetNumber, type });
    }),
  );

  await step('schedules and activities', async () => {
    const note = await topUp(`${pp}/schedules`, async (i) => {
      await s.ok('POST', `${pp}/schedules`, { name: SCHEDULES[i % SCHEDULES.length] });
    });
    // Give the first programme ten activities in sequence, so the Gantt has something to draw.
    const first = (await s.ok<{ data: Array<{ id: string }> }>('GET', `${pp}/schedules`)).data[0];
    if (!first) return note;
    const sp = `${pp}/schedules/${first.id}`;
    const detail = await s.ok<{ activities?: unknown[] }>('GET', sp);
    const done = detail.activities?.length ?? 0;
    if (done >= TARGET) return `${note}; activities existing`;
    const ids: string[] = [];
    const base = addDays(today, -60);
    for (const [i, [name, from, to]] of ACTIVITIES.entries()) {
      const a = await s.ok<{ id: string }>('POST', `${sp}/activities`, {
        name,
        kind: from === to ? 'milestone' : 'task',
        wbs: `${i + 1}`,
        start: addDays(base, from),
        finish: addDays(base, to),
        pctComplete: Math.max(
          0,
          Math.min(100, Math.round(((60 - from) / Math.max(to - from, 1)) * 100)),
        ),
      });
      ids.push(a.id);
    }
    for (let i = 1; i < ids.length; i++)
      await s.call('POST', `${sp}/dependencies`, {
        predecessorId: ids[i - 1],
        successorId: ids[i],
        type: 'FS',
        lagDays: 0,
      });
    return `${note}; ${ids.length} activities`;
  });

  // A project has one induction, so the ten are spread over the ten projects.
  await step('inductions', async () => {
    let added = 0;
    const all = (await s.ok<{ data: Array<{ id: string }> }>('GET', `${org}/projects`)).data;
    for (const [i, project] of all.slice(0, TARGET).entries()) {
      const ip = `${org}/projects/${project.id}`;
      if ((await count(`${ip}/inductions`)) > 0) continue;
      added++;
      const title = INDUCTIONS[i % INDUCTIONS.length]!;
      const ind = await s.ok<{ id?: string; induction?: { id: string } }>(
        'POST',
        `${ip}/inductions`,
        {
          title,
          validityMonths: 12,
        },
      );
      const id = ind.id ?? ind.induction?.id;
      const text = (body: string) => [{ type: 'text', body }];
      await s.ok('GET', `${ip}/inductions/${id}`);
      await s.ok(
        'PUT',
        `${ip}/inductions/${id}/draft`,
        {
          content: {
            sections: INDUCTION_SECTIONS.map(([key, title, body]) => ({
              key,
              title,
              blocks: text(`${body} Sample data only.`),
            })),
            quiz: INDUCTION_SECTIONS.map(([key, title], q) => ({
              section: key,
              question: `Which is correct for "${title}"?`,
              options: [
                'Follow the induction and ask if unsure',
                'Ignore it',
                'Leave it to the next shift',
              ],
              answerIndex: 0,
              critical: q === 2,
            })),
            passMark: 80,
          },
        },
        { 'if-match': s.etag ?? '' },
      );
      const pub = await s.call(
        'POST',
        `${ip}/inductions/${id}/publish`,
        { redo: 'none' },
        { 'if-match': s.etag ?? '' },
      );
      if (pub.status >= 300)
        console.warn(`Publishing induction -> ${pub.status} ${JSON.stringify(pub.json)}`);
    }
    return `${added} added`;
  });

  await step('tender packages', () =>
    topUp(`${pp}/tender-packages`, async (i) => {
      const [name, trade] = TENDERS[i % TENDERS.length]!;
      await s.ok('POST', `${pp}/tender-packages`, {
        name: `${name} package`,
        trade,
        dueAt: new Date(Date.now() + (10 + i) * 86400_000).toISOString(),
        scope: [
          {
            key: `${trade.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_allowance`,
            description: `${trade} allowance`,
            quantity: String(10 + i),
            unit: 'item',
            source: 'typed',
          },
        ],
      });
    }),
  );
}
