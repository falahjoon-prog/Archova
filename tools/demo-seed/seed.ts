// pnpm demo:seed: creates the synthetic demo tenant through the public API, exactly as a person in the browser
// would (cookie session on the app host, Origin and CSRF headers). Safe to re-run: it reuses the demo org and
// companies and skips projects that already exist. Never point it at an environment with customer data.
//
// Env: SEED_APP_ORIGIN (e.g. https://demo.archova.com.au), SEED_PASSWORD (the demo login's password),
// SEED_EMAIL (default demo@archova.com.au), SEED_NAME (default "Demo Builder").
import { createHash } from 'node:crypto';
import { addDays, isoWeekday, localDateOf, type LocalDate, zonedToUtc } from '@archova/time';
import { COMPANIES, type CompanyKey, ORG, PROJECTS } from './data';
import { seedExtra } from './extra';
import { makePdf } from './pdf';
import { Session } from './session';

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

const ORIGIN = new URL(need('SEED_APP_ORIGIN')).origin;
const EMAIL = process.env.SEED_EMAIL ?? 'demo@archova.com.au';
const PASSWORD = need('SEED_PASSWORD');
const NAME = process.env.SEED_NAME ?? 'Demo Builder';

const s = new Session(ORIGIN);
const login = await s.call('POST', '/v1/auth/login', { email: EMAIL, password: PASSWORD });
if (login.status === 401 || login.status === 400 || login.status === 404) {
  await s.ok('POST', '/v1/auth/signup', { email: EMAIL, password: PASSWORD, name: NAME });
  console.log(`Signed up ${EMAIL}`);
} else if (login.status >= 300) {
  throw new Error(`login -> ${login.status} ${JSON.stringify(login.json)}`);
}

const me = await s.ok<{
  user: { id: string };
  memberships: Array<{ orgId: string; orgSlug: string }>;
}>('GET', '/v1/me');
let orgId = me.memberships.find((m) => m.orgSlug === ORG.slug)?.orgId;
const o = () => `/v1/orgs/${orgId}`;
const company = {} as Record<CompanyKey, string>;
if (orgId) {
  const existing = await s.ok<{ data: Array<{ id: string; name: string }> }>(
    'GET',
    `${o()}/companies`,
  );
  for (const c of COMPANIES) {
    const found = existing.data.find((e) => e.name === c.name);
    if (found) company[c.key] = found.id;
  }
} else {
  orgId = (await s.ok<{ id: string }>('POST', '/v1/orgs', ORG)).id;
  console.log(`Created ${ORG.name}`);
}
for (const c of COMPANIES) {
  if (company[c.key]) continue;
  const created = await s.ok<{ id: string }>('POST', `${o()}/companies`, {
    name: c.name,
    type: c.type,
    trades: [...c.trades],
    email: `office@${c.key}.example.com`,
  });
  company[c.key] = created.id;
}
const existingProjects = new Map(
  (await s.ok<{ data: Array<{ id: string; name: string }> }>('GET', `${o()}/projects`)).data.map(
    (p) => [p.name, p.id],
  ),
);
const projectIds: string[] = [];

async function upload(projectId: string, module: string, filename: string, bytes: Uint8Array) {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const up = await s.ok<{ id: string; uploadUrl: string; uploadHeaders: Record<string, string> }>(
    'POST',
    `${o()}/uploads`,
    { filename, mime: 'application/pdf', sizeBytes: bytes.length, sha256, module, projectId },
  );
  const put = await fetch(up.uploadUrl, { method: 'PUT', headers: up.uploadHeaders, body: bytes });
  if (!put.ok) throw new Error(`upload of ${filename} -> ${put.status} ${await put.text()}`);
  const done = await s.ok<{ id: string }>('POST', `${o()}/uploads/${up.id}/complete`);
  return done.id;
}

for (const p of PROJECTS) {
  const existingId = existingProjects.get(p.name);
  if (existingId) {
    projectIds.push(existingId);
    console.log(`${p.name} already exists; skipped.`);
    continue;
  }
  const { sheets, documents, ...fields } = p;
  const project = await s.ok<{ id: string }>('POST', `${o()}/projects`, fields);
  projectIds.push(project.id);
  const pp = `${o()}/projects/${project.id}`;

  // Documents in folders.
  const folders = new Map<string, string>();
  for (const name of new Set(documents.map((d) => d.folder))) {
    const f = await s.ok<{ id: string }>('POST', `${pp}/folders`, { name });
    folders.set(name, f.id);
  }
  const docRevisionIds: string[] = [];
  for (const d of documents) {
    const fileId = await upload(
      project.id,
      'documents',
      `${d.docNumber}.pdf`,
      makePdf({
        project: p.name,
        number: d.docNumber,
        title: d.title,
        rev: '1',
        lines: [d.title, `${p.name}, ${p.address.suburb} ${p.address.state}`],
      }),
    );
    const doc = await s.ok<{ document: { id: string } }>('POST', `${pp}/documents`, {
      folderId: folders.get(d.folder),
      title: d.title,
      docNumber: d.docNumber,
      docType: d.docType,
      status: 'approved',
      revision: { rev: '1', fileId, issuedFor: 'Construction', issuedDate: p.startDate },
    });
    // A second revision, so the register shows history (rev 1 superseded by rev 2).
    const docId = doc.document.id;
    const rev2File = await upload(
      project.id,
      'documents',
      `${d.docNumber}-2.pdf`,
      makePdf({
        project: p.name,
        number: d.docNumber,
        title: d.title,
        rev: '2',
        lines: [d.title, 'Revision 2: updated after design coordination.'],
      }),
    );
    const withRev2 = await s.ok<{ revisions: Array<{ id: string; rev: string }> }>(
      'POST',
      `${pp}/documents/${docId}/revisions`,
      {
        rev: '2',
        fileId: rev2File,
        issuedFor: 'Construction',
        issuedDate: p.startDate,
      },
    );
    docRevisionIds.push(withRev2.revisions.find((r) => r.rev === '2')!.id);
  }

  // A drawing set, published, with one markup on the ground floor plan.
  const set = await s.ok<{ id: string }>('POST', `${pp}/drawing-sets`, {
    name: p.status === 'tender' ? 'Tender Issue' : 'Issued for Construction',
    issuedDate: p.startDate,
    receivedDate: p.startDate,
  });
  for (const sh of sheets) {
    const fileId = await upload(
      project.id,
      'drawings',
      `${sh.number}.pdf`,
      makePdf({ project: p.name, number: sh.number, title: sh.title, rev: 'A' }),
    );
    await s.ok('POST', `${pp}/drawing-sets/${set.id}/revisions`, {
      sheetNumber: sh.number,
      title: sh.title,
      discipline: sh.discipline,
      rev: 'A',
      issuedFor: p.status === 'tender' ? 'for_tender' : 'for_construction',
      fileId,
      drawingDate: p.startDate,
    });
  }
  const published = await s.ok<{ revisions: Array<{ id: string; sheetNumber: string }> }>(
    'POST',
    `${pp}/drawing-sets/${set.id}/publish`,
    { confirmNewSheets: true },
  );
  // A transmittal of the drawing set to the architect.
  const t = await s.ok<{ transmittal: { id: string } }>('POST', `${pp}/transmittals`, {
    subject: `${p.number} drawings for coordination`,
    purpose: p.status === 'tender' ? 'for_tender' : 'for_construction',
    fromCompanyId: undefined,
    message: 'Please find the current drawing set attached. Sample data only.',
    recipients: [
      {
        email: 'documents@arch.example.com',
        name: 'Coastline Architects',
        companyId: company.arch,
        role: 'to',
      },
    ],
    items: [
      ...published.revisions
        .slice(0, 4)
        .map((r) => ({ revisionType: 'drawing', revisionId: r.id })),
      ...docRevisionIds.slice(0, 1).map((id) => ({ revisionType: 'document', revisionId: id })),
    ],
  });
  await s.ok(
    'POST',
    `${pp}/transmittals/${t.transmittal.id}/send`,
    {},
    {
      'if-match': s.etag ?? '',
    },
  );
  // Rev B of the ground floor plan, so the register shows a superseded sheet; the markups go on the current rev.
  const setB = await s.ok<{ id: string }>('POST', `${pp}/drawing-sets`, {
    name: 'Revision B',
    issuedDate: p.startDate,
    receivedDate: p.startDate,
  });
  const planSheet = sheets.find((sh) => sh.number === 'A-101') ?? sheets[0]!;
  await s.ok('POST', `${pp}/drawing-sets/${setB.id}/revisions`, {
    sheetNumber: planSheet.number,
    title: planSheet.title,
    discipline: planSheet.discipline,
    rev: 'B',
    issuedFor: p.status === 'tender' ? 'for_tender' : 'for_construction',
    fileId: await upload(
      project.id,
      'drawings',
      `${planSheet.number}-B.pdf`,
      makePdf({
        project: p.name,
        number: planSheet.number,
        title: planSheet.title,
        rev: 'B',
        lines: ['Rev B: accessible WC door relocated.'],
      }),
    ),
    drawingDate: p.startDate,
  });
  const publishedB = await s.ok<{ revisions: Array<{ id: string; sheetNumber: string }> }>(
    'POST',
    `${pp}/drawing-sets/${setB.id}/publish`,
    { confirmNewSheets: true },
  );
  const plan = publishedB.revisions[0]!;
  await s.ok('POST', `${pp}/drawing-revisions/${plan.id}/markups`, {
    visibility: 'project',
    shapes: [
      {
        id: 'c1',
        kind: 'cloud',
        from: { x: 0.32, y: 0.4 },
        to: { x: 0.48, y: 0.55 },
        color: '#d92d20',
        strokeWidth: 2,
      },
      {
        id: 'a1',
        kind: 'arrow',
        from: { x: 0.56, y: 0.36 },
        to: { x: 0.47, y: 0.44 },
        color: '#d92d20',
        strokeWidth: 2,
      },
      {
        id: 't1',
        kind: 'text',
        at: { x: 0.5, y: 0.34 },
        text: 'Confirm door swing to accessible WC',
        color: '#d92d20',
      },
    ],
  });
  // An open RFI to the architect, pinned to the clouded area on the ground floor plan.
  const rfi = await s.ok<{ rfi: { id: string } }>('POST', `${pp}/rfis`, {
    subject: 'Accessible WC door swing',
    question:
      'Drawing A-101 rev B shows the accessible WC door opening inward. Please confirm the swing direction and ' +
      'the required circulation space under AS 1428.1. Sample data only.',
    receivedFromCompanyId: company.arch,
    assigneeIds: [me.user.id],
    costImpact: 'tbc',
    pin: { drawingRevisionId: plan.id, x: 0.4, y: 0.47 },
  });
  const opened = await s.call(
    'POST',
    `${pp}/rfis/${rfi.rfi.id}/open`,
    {},
    { 'if-match': s.etag ?? '' },
  );
  if (opened.status >= 300)
    console.warn(`Opening the sample RFI -> ${opened.status} ${JSON.stringify(opened.json)}`);

  console.log(
    `Seeded ${p.name}: ${documents.length} documents (2 revisions each), ${sheets.length} drawings (A-101 at rev B), 1 transmittal, 1 RFI`,
  );
}

// Site diary: the last five working days on each active project, in the project's own time zone (X34): weather,
// labour from three subcontractors, a rain delay, and the oldest day submitted. Skipped for a project that already
// has diary days in that range, so re-runs don't duplicate lines.
const WEATHER = [
  {
    minTempC: 14,
    maxTempC: 23,
    rainfallMm: 0,
    windKmh: 12,
    windDirection: 'NE',
    am: 'Sunny',
    pm: 'Sunny',
  },
  {
    minTempC: 15,
    maxTempC: 21,
    rainfallMm: 18,
    windKmh: 30,
    windDirection: 'S',
    am: 'Showers',
    pm: 'Heavy rain',
  },
  {
    minTempC: 12,
    maxTempC: 19,
    rainfallMm: 2,
    windKmh: 22,
    windDirection: 'SW',
    am: 'Overcast',
    pm: 'Clearing',
  },
  {
    minTempC: 13,
    maxTempC: 24,
    rainfallMm: 0,
    windKmh: 10,
    windDirection: 'E',
    am: 'Sunny',
    pm: 'Fine',
  },
  {
    minTempC: 16,
    maxTempC: 26,
    rainfallMm: 0,
    windKmh: 15,
    windDirection: 'NE',
    am: 'Fine',
    pm: 'Hot',
  },
];
const LABOUR: Array<{ key: CompanyKey; trade: string; headcount: number; hours: number }> = [
  { key: 'conc', trade: 'Concrete', headcount: 6, hours: 48 },
  { key: 'elec', trade: 'Electrical', headcount: 3, hours: 24 },
  { key: 'hyd', trade: 'Plumbing', headcount: 2, hours: 16 },
];

for (const [i, p] of PROJECTS.entries()) {
  if (p.status !== 'active') continue;
  const pp = `${o()}/projects/${projectIds[i]}`;
  const days: LocalDate[] = [];
  for (
    let d = addDays(localDateOf(new Date(), p.timezone), -1);
    days.length < 5;
    d = addDays(d, -1)
  )
    if (isoWeekday(d) <= 5) days.unshift(d);
  const existing = await s.ok<{ data: unknown[] }>(
    'GET',
    `${pp}/diary?from=${days[0]}&to=${days[days.length - 1]}`,
  );
  if (existing.data.length) {
    console.log(`${p.name} already has diary days; skipped.`);
    continue;
  }
  for (const [n, date] of days.entries()) {
    const w = WEATHER[n % WEATHER.length]!;
    const rain = w.rainfallMm > 10;
    await s.ok('PUT', `${pp}/diary/${date}`, {
      weatherOverride: {
        minTempC: w.minTempC,
        maxTempC: w.maxTempC,
        rainfallMm: w.rainfallMm,
        windKmh: w.windKmh,
        windDirection: w.windDirection,
        conditions: { am: w.am, midday: null, pm: w.pm },
      },
      siteConditions: rain ? 'Wet. Excavation pumped out; access road boggy.' : 'Dry, good access.',
      notes: rain
        ? 'Slab pour on level 1 postponed to tomorrow. Sample data only.'
        : 'Work progressing to programme. Sample data only.',
    });
    for (const l of LABOUR)
      await s.ok('POST', `${pp}/diary/${date}/labour`, {
        companyId: company[l.key],
        trade: l.trade,
        headcount: rain && l.key === 'conc' ? 4 : l.headcount,
        hours: rain && l.key === 'conc' ? 14 : l.hours,
      });
    if (rain)
      await s.ok('POST', `${pp}/diary/${date}/delays`, {
        type: 'weather',
        description:
          'Heavy rain from 11am; concrete pour postponed and crew stood down for the afternoon.',
        hours: 3.5,
        affectedCompanyIds: [company.conc],
      });
  }
  // The oldest day is submitted and locked; the rest stay drafts.
  await s.ok('GET', `${pp}/diary/${days[0]}`);
  const submitted = await s.call(
    'POST',
    `${pp}/diary/${days[0]}/submit`,
    {},
    { 'if-match': s.etag ?? '' },
  );
  if (submitted.status >= 300)
    console.warn(
      `Submitting the sample diary day -> ${submitted.status} ${JSON.stringify(submitted.json)}`,
    );
  console.log(
    `Seeded ${p.name} diary: ${days[0]} to ${days[days.length - 1]}, one weather delay, first day submitted`,
  );
}

// Site sign-ins (X54): today's register on each active project, so "who's on site" has people on it. Crews from
// the three subcontractors are still on site; a plumber left early, an architect visited and a delivery came and
// went. The delivery driver's company is typed at the gate, so it waits for confirmation (ATT-AC2). Past days
// are left to the diary's own labour lines. Skipped for a project that already has sign-ins today; anyone still
// signed in from an earlier run is signed out at 3:30pm that day first (until the worker auto-closes sessions).
const CREW: Array<{
  role: string;
  key: CompanyKey | null;
  other?: string;
  kind: 'worker' | 'visitor' | 'delivery';
  in: string;
  out?: string;
}> = [
  { role: 'Worker Concrete 1', key: 'conc', kind: 'worker', in: '06:45' },
  { role: 'Worker Concrete 2', key: 'conc', kind: 'worker', in: '06:47' },
  { role: 'Worker Concrete 3', key: 'conc', kind: 'worker', in: '06:52' },
  { role: 'Worker Concrete 4', key: 'conc', kind: 'worker', in: '06:58' },
  { role: 'Electrician 1', key: 'elec', kind: 'worker', in: '07:02' },
  { role: 'Electrician 2', key: 'elec', kind: 'worker', in: '07:05' },
  { role: 'Plumber 1', key: 'hyd', kind: 'worker', in: '07:10' },
  { role: 'Plumber 2', key: 'hyd', kind: 'worker', in: '07:12', out: '11:00' },
  {
    role: 'Delivery Driver',
    key: null,
    other: 'Sample Readymix Co',
    kind: 'delivery',
    in: '08:30',
    out: '08:50',
  },
  { role: 'Architect Visitor', key: 'arch', kind: 'visitor', in: '10:00', out: '11:15' },
];

const workerIds = new Map<string, string>();
let crewNo = 0;
for (const [i, p] of PROJECTS.entries()) {
  if (p.status !== 'active') continue;
  // Workers belong to the builder, not the project, so each project gets its own crew.
  const crew = String.fromCharCode(65 + crewNo++);
  const pp = `${o()}/projects/${projectIds[i]}`;
  const today = localDateOf(new Date(), p.timezone);
  const signedIn = await s.ok<{ data: unknown[] }>(
    'GET',
    `${pp}/attendance/sessions?date=${today}`,
  );
  if (signedIn.data.length) {
    console.log(`${p.name} already has sign-ins today; skipped.`);
    continue;
  }
  const sites = await s.ok<{ data: Array<{ id: string }> }>('GET', `${pp}/attendance/sites`);
  let siteId = sites.data[0]?.id;
  if (!siteId) {
    siteId = (await s.ok<{ id: string }>('POST', `${pp}/attendance/sites`, { name: 'Main site' }))
      .id;
    // The gate's QR code is shown only once; reissue it from the web app to print a poster.
    await s.ok('POST', `${pp}/attendance/sites/${siteId}/gates`, { name: 'Front gate' });
  }
  if (!workerIds.size)
    for (const w of (
      await s.ok<{ data: Array<{ id: string; fullName: string }> }>('GET', `${pp}/workers`)
    ).data)
      workerIds.set(w.fullName, w.id);
  const at = (time: string) => zonedToUtc(today, time, p.timezone).toISOString();
  for (const c of CREW) {
    const name = `Sample ${c.role} ${crew}`;
    let workerId = workerIds.get(name);
    if (!workerId) {
      workerId = (
        await s.ok<{ id: string }>('POST', `${pp}/workers`, {
          fullName: name,
          kind: c.kind,
          ...(c.key ? { companyId: company[c.key] } : { companyNameOther: c.other }),
        })
      ).id;
      workerIds.set(name, workerId);
    }
    const signIn = { workerId, siteId, kind: 'sign_in', clientAt: at(c.in) };
    const r = await s.ok<{ outcome: string; session: { localDate: string } | null }>(
      'POST',
      `${pp}/attendance/events`,
      signIn,
    );
    if (r.outcome === 'already_on_site') {
      await s.ok('POST', `${pp}/attendance/events`, {
        workerId,
        kind: 'sign_out',
        clientAt: zonedToUtc(r.session!.localDate, '15:30', p.timezone).toISOString(),
      });
      await s.ok('POST', `${pp}/attendance/events`, signIn);
    }
    if (c.out)
      await s.ok('POST', `${pp}/attendance/events`, {
        workerId,
        kind: 'sign_out',
        clientAt: at(c.out),
      });
  }
  console.log(
    `Seeded ${p.name} sign-ins for ${today}: ${CREW.filter((c) => !c.out).length} on site, ${CREW.filter((c) => c.out).length} signed out`,
  );
}

// Ten records of each major kind on the first active project (see extra.ts).
await seedExtra({
  s,
  org: o(),
  projects: PROJECTS.map((p, i) => ({
    id: projectIds[i]!,
    name: p.name,
    status: p.status,
    timezone: p.timezone,
  })),
  company,
  userId: me.user.id,
  origin: ORIGIN,
  password: PASSWORD,
});

// Ask Nova answers only from indexed documents and drawings. Indexing is idempotent, so every run brings each
// project up to date. A failure here (e.g. Bedrock not enabled yet) leaves the demo usable without Nova.
for (const id of projectIds) {
  const r = await s.call('POST', `${o()}/projects/${id}/ai/index`, {});
  if (r.status >= 300)
    console.warn(`Nova indexing of project ${id} -> ${r.status} ${JSON.stringify(r.json)}`);
  else console.log(`Indexed project ${id} for Nova: ${JSON.stringify(r.json)}`);
}

console.log(`Done. Sign in at ${ORIGIN}/login as ${EMAIL}.`);
