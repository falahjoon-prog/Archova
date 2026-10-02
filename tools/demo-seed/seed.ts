// pnpm demo:seed: creates the synthetic demo tenant through the public API, exactly as a person in the browser
// would (cookie session on the app host, Origin and CSRF headers). Safe to re-run: it reuses the demo org and
// companies and skips projects that already exist. Never point it at an environment with customer data.
//
// Env: SEED_APP_ORIGIN (e.g. https://demo.archova.com.au), SEED_PASSWORD (the demo login's password),
// SEED_EMAIL (default demo@archova.com.au), SEED_NAME (default "Demo Builder").
import { createHash, randomUUID } from 'node:crypto';
import { addDays, isoWeekday, localDateOf, type LocalDate } from '@archova/time';
import { COMPANIES, type CompanyKey, ORG, PROJECTS } from './data';
import { makePdf } from './pdf';

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

const ORIGIN = new URL(need('SEED_APP_ORIGIN')).origin;
const EMAIL = process.env.SEED_EMAIL ?? 'demo@archova.com.au';
const PASSWORD = need('SEED_PASSWORD');
const NAME = process.env.SEED_NAME ?? 'Demo Builder';

class Session {
  private cookies = new Map<string, string>();
  private csrf: string | null = null;
  /** ETag of the last response, for If-Match on the next update. */
  etag: string | null = null;

  async call<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ): Promise<{ status: number; json: T }> {
    const headers: Record<string, string> = { accept: 'application/json', ...extra };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET') {
      headers.origin = ORIGIN;
      if (this.csrf) headers['x-csrf-token'] = this.csrf;
    }
    if (method === 'POST' && !headers['idempotency-key']) headers['idempotency-key'] = randomUUID();
    let res: Response;
    // Rate limits (Nova today, the WAF later) answer 429 with Retry-After; wait and send the same request again,
    // with the same Idempotency-Key.
    for (let attempt = 0; ; attempt++) {
      if (this.cookies.size)
        headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
      res = await fetch(`${ORIGIN}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status !== 429 || attempt >= 4) break;
      const wait = Math.min(Number(res.headers.get('retry-after')) || 5, 60);
      console.log(`${method} ${path} rate limited; retrying in ${wait}s`);
      await res.text();
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair!.indexOf('=');
      const name = pair!.slice(0, i).trim();
      const value = pair!.slice(i + 1).trim();
      if (value === '' || /max-age=0/i.test(c)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    this.etag = res.headers.get('etag');
    const text = await res.text();
    const json = (text ? JSON.parse(text) : {}) as T & { csrfToken?: string };
    if (json && typeof json === 'object' && json.csrfToken) this.csrf = json.csrfToken;
    return { status: res.status, json };
  }

  async ok<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    extra?: Record<string, string>,
  ): Promise<T> {
    const r = await this.call<T>(method, path, body, extra);
    if (r.status >= 300)
      throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.json)}`);
    return r.json;
  }
}

const s = new Session();
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

// Ask Nova answers only from indexed documents and drawings. Indexing is idempotent, so every run brings each
// project up to date. A failure here (e.g. Bedrock not enabled yet) leaves the demo usable without Nova.
for (const id of projectIds) {
  const r = await s.call('POST', `${o()}/projects/${id}/ai/index`, {});
  if (r.status >= 300)
    console.warn(`Nova indexing of project ${id} -> ${r.status} ${JSON.stringify(r.json)}`);
  else console.log(`Indexed project ${id} for Nova: ${JSON.stringify(r.json)}`);
}

console.log(`Done. Sign in at ${ORIGIN}/login as ${EMAIL}.`);
