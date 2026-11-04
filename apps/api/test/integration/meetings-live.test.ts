import { inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localDateOf } from '@archova/time';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  uploadBytes,
  type TestContext,
} from './helpers';

// Live agenda sections (product/07 MTG-US5, AC6), through the real meetings, rfis, submittals, defects and diary modules.
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

type Section = {
  id: string;
  title: string;
  internalOnly: boolean;
  liveSource: string | null;
  live: {
    source: string;
    asOf: string;
    restricted: boolean;
    truncated: boolean;
    rows: Array<{
      ref: string;
      title: string;
      detail: string;
      link: { type: string; id: string } | null;
    }>;
  } | null;
};
type Detail = { meeting: { id: string }; sections: Section[] };

/** True when the PDF prints `text`: page content is deflated, with standard-font text as hex or literal strings. */
const pdfHas = (bytes: Buffer, text: string) => {
  const raw = bytes.toString('latin1');
  const hex = Buffer.from(text, 'latin1').toString('hex');
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body: string;
    try {
      body = inflateSync(Buffer.from(m[1]!, 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    if (body.includes(`(${text}`) || body.toLowerCase().includes(hex)) return true;
  }
  return false;
};

async function setup() {
  const pm = await signUp(t.app, 'live-pm');
  const sub = await signUp(t.app, 'live-sub');
  const org = await createOrg(pm.browser, 'Live Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower L', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  const subCo = await addMember(
    pm.browser,
    org.id,
    project.id,
    sub.email,
    'Subcontractor',
    'Sparky',
  );
  const today = localDateOf(new Date(), project.timezone);
  const series = (
    await pm.browser.post(`${base}/meeting-series`, {
      name: 'Site meeting',
      template: 'site_coordination',
      defaultAttendees: [
        { name: 'Dana PM', companyName: 'Live Builder', role: 'PM', email: 'dana@example.com' },
      ],
    })
  ).json();
  const meeting = (
    await pm.browser.post(`${base}/meeting-series/${series.id}/meetings`, {
      heldAt: new Date().toISOString(),
    })
  ).json() as Detail;
  return { pm, sub, org, project, base, subCo, today, series, meeting, m: meeting.meeting.id };
}

async function overdueRfi(s: Awaited<ReturnType<typeof setup>>, subject: string) {
  const draft = await s.pm.browser.post(`${s.base}/rfis`, {
    subject,
    question: 'Which detail governs here?',
    assigneeIds: [s.pm.userId],
    dueDate: '2020-01-10',
  });
  expect(draft.statusCode).toBe(201);
  const id = draft.json().rfi.id as string;
  const opened = await s.pm.browser.post(`${s.base}/rfis/${id}/open`, undefined, {
    'if-match': draft.headers.etag as string,
  });
  expect(opened.statusCode).toBe(200);
  return id;
}

describe('Live agenda sections (MTG-US5)', () => {
  it('fills sections from the registers, freezes them at issue, keeps them builder-only and carries them forward', async () => {
    const s = await setup();
    const rfi1 = await overdueRfi(s, 'Slab edge detail at grid C4');

    // A pinned defect, issued, so it is open.
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const set = (await s.pm.browser.post(`${s.base}/drawing-sets`, { name: 'IFC' })).json();
    const fileId = await uploadBytes(t, s.pm.browser, s.org.id, s.project.id, await doc.save());
    const rev = await s.pm.browser.post(`${s.base}/drawing-sets/${set.id}/revisions`, {
      sheetNumber: 'A-101',
      title: 'Level 3',
      rev: 'A',
      fileId,
    });
    await s.pm.browser.post(`${s.base}/drawing-sets/${set.id}/publish`, { confirmNewSheets: true });
    const defect = await s.pm.browser.post(`${s.base}/defects`, {
      title: 'Chipped tile in bathroom 302',
      priority: 'high',
      trade: 'tiling',
      assigneeCompanyId: s.subCo.companyId,
      pin: { drawingRevisionId: rev.json().id, x: 0.4, y: 0.6 },
    });
    expect(
      (
        await s.pm.browser.post(
          `${s.base}/defects/${defect.json().defect.id}/transition`,
          { action: 'issue' },
          { 'if-match': defect.headers.etag as string },
        )
      ).statusCode,
    ).toBe(200);

    // A submittal required on site in three days, and a delay line today.
    const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    expect(
      (
        await s.pm.browser.post(`${s.base}/submittals`, {
          title: 'Switchboard shop drawings',
          type: 'shop_drawing',
          responsibleCompanyId: s.subCo.companyId,
          requiredOnSite: soon,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await s.pm.browser.post(`${s.base}/diary/${s.today}/delays`, {
          type: 'weather',
          description: 'Rain stopped the pour',
          hours: 2,
          affectedCompanyIds: [s.subCo.companyId],
        })
      ).statusCode,
    ).toBe(201);

    const add = async (liveSource: string, title = liveSource) => {
      const r = await s.pm.browser.post(`${s.base}/meetings/${s.m}/sections`, {
        title,
        liveSource,
      });
      expect(r.statusCode).toBe(201);
      return (r.json() as Detail).sections;
    };
    await add('rfis_overdue', 'Overdue RFIs');
    await add('submittals_due', 'Submittals due');
    await add('defects_open', 'Open defects by trade');
    const sections = await add('delays_week', 'Delays this week');
    const by = (title: string) => sections.find((x) => x.title === title)!;

    // Each is builder-only, and lists what the register holds for the reader.
    for (const title of [
      'Overdue RFIs',
      'Submittals due',
      'Open defects by trade',
      'Delays this week',
    ])
      expect(by(title)).toMatchObject({
        internalOnly: true,
        live: { restricted: false, truncated: false },
      });
    expect(by('Overdue RFIs').live!.rows).toEqual([
      expect.objectContaining({
        ref: 'RFI-001',
        title: 'Slab edge detail at grid C4',
        detail: 'Due 2020-01-10',
        link: { type: 'rfi', id: rfi1 },
      }),
    ]);
    expect(by('Submittals due').live!.rows[0]).toMatchObject({
      ref: 'SD-001',
      title: 'Switchboard shop drawings',
      link: { type: 'submittal' },
    });
    expect(by('Open defects by trade').live!.rows[0]).toMatchObject({
      ref: 'DEF-0001',
      detail: 'tiling, Open',
      link: { type: 'defect' },
    });
    expect(by('Delays this week').live!.rows[0]).toMatchObject({
      ref: s.today,
      title: 'Rain stopped the pour',
      detail: '2 h, weather',
      link: null,
    });
    expect(by('Overdue RFIs').liveSource).toBe('rfis_overdue');

    // Issue freezes the lists as they stand (MTG-AC6): a later RFI shows in the working minutes, not in version 1.
    const issued = await s.pm.browser.post(`${s.base}/meetings/${s.m}/issue`, {
      recipients: [{ name: 'Dana PM', email: 'dana@example.com' }],
    });
    expect(issued.statusCode).toBe(200);
    await overdueRfi(s, 'Waterproofing membrane brand');
    const working = (await s.pm.browser.get(`${s.base}/meetings/${s.m}`)).json() as Detail;
    expect(working.sections.find((x) => x.title === 'Overdue RFIs')!.live!.rows).toHaveLength(2);
    const v1 = Buffer.from(
      (await s.pm.browser.get(`${s.base}/meetings/${s.m}/versions/1/pdf`)).json().dataBase64,
      'base64',
    );
    expect(pdfHas(v1, 'RFI-001')).toBe(true);
    expect(pdfHas(v1, 'RFI-002')).toBe(false);
    expect(pdfHas(v1, 'DEF-0001')).toBe(true);

    // A subcontractor who attended sees none of the live lists, in the data or the PDF.
    const next = (
      await s.pm.browser.post(`${s.base}/meeting-series/${s.series.id}/meetings`, {
        heldAt: new Date(Date.now() + 86400000).toISOString(),
      })
    ).json() as Detail;
    // The next meeting keeps the live sections (carried forward).
    expect(next.sections.filter((x) => x.liveSource).map((x) => x.liveSource)).toEqual([
      'rfis_overdue',
      'submittals_due',
      'defects_open',
      'delays_week',
    ]);
    expect(next.sections.find((x) => x.liveSource === 'rfis_overdue')!.live!.rows).toHaveLength(2);
  });

  it('rejects an unknown source, and a subcontractor who attended cannot add or see live lists', async () => {
    const s = await setup();
    const bad = await s.pm.browser.post(`${s.base}/meetings/${s.m}/sections`, {
      title: 'Nonsense',
      liveSource: 'everything',
    });
    expect(bad.statusCode).toBe(422);
    const r = await s.pm.browser.post(`${s.base}/meetings/${s.m}/sections`, {
      title: 'Overdue RFIs',
      liveSource: 'rfis_overdue',
    });
    expect(r.statusCode).toBe(201);
    // The subcontractor is not on the project team: they cannot add a live list.
    const denied = await s.sub.browser.post(`${s.base}/meetings/${s.m}/sections`, {
      title: 'Overdue RFIs',
      liveSource: 'rfis_overdue',
    });
    expect(denied.statusCode).toBeGreaterThanOrEqual(403);
    // Issued to them, the live list is not in what they read or download.
    const attendees = (
      await s.pm.browser.put(`${s.base}/meetings/${s.m}/attendees`, {
        attendees: [
          { name: 'Dana PM', companyName: 'Live Builder', email: 'dana@example.com' },
          { name: 'Sam Sparky', companyName: 'Sparky', companyId: s.subCo.companyId },
        ],
      })
    ).json() as Detail;
    expect(attendees.sections.some((x) => x.live)).toBe(true);
    expect(
      (
        await s.pm.browser.post(`${s.base}/meetings/${s.m}/issue`, {
          recipients: [{ name: 'Dana PM', email: 'dana@example.com' }],
        })
      ).statusCode,
    ).toBe(200);
    const seen = (await s.sub.browser.get(`${s.base}/meetings/${s.m}`)).json() as Detail;
    expect(seen.sections.some((x) => x.live || x.liveSource || x.title === 'Overdue RFIs')).toBe(
      false,
    );
    expect(seen.sections.length).toBeGreaterThan(0);
  });
});
