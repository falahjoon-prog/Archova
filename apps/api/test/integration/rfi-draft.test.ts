import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FAKE_RESPONDERS } from '@archova/mod-ai';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  uploadBytes,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

async function pdf(pages: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([595, 842]);
    lines.forEach((text, i) => page.drawText(text, { x: 50, y: 780 - i * 22, size: 11, font }));
  }
  return doc.save();
}

async function setup() {
  const pm = await signUp(t.app, 'rfid-pm');
  const eng = await signUp(t.app, 'rfid-eng');
  const sub = await signUp(t.app, 'rfid-sub');
  const org = await createOrg(pm.browser, 'Draft Builders');
  const project = await createProject(pm.browser, org.id, { name: 'Harbourside', state: 'NSW' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(pm.browser, org.id, project.id, eng.email, 'Consultant', 'Fire Eng Co');
  await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Plumbco');

  const folder = (await pm.browser.post(`${base}/folders`, { name: 'Specifications' })).json();
  const fileId = await uploadBytes(
    t,
    pm.browser,
    org.id,
    project.id,
    await pdf([
      [
        '0821.3.2 FIRE RESISTANCE LEVELS',
        'Walls to the Level 3 corridor shall achieve an FRL of 90/90/90.',
        'Riser walls shall achieve an FRL of 120/120/120.',
      ],
    ]),
  );
  const doc = await pm.browser.post(`${base}/documents`, {
    folderId: folder.id,
    title: 'Fire Protection Specification',
    docNumber: 'SPEC-0821',
    revision: { rev: 'C', fileId },
  });
  expect(doc.statusCode).toBe(201);
  expect((await pm.browser.post(`${base}/ai/index`)).statusCode).toBe(200);
  return { pm, eng, sub, org, project, base, documentId: doc.json().document.id as string };
}
type Setup = Awaited<ReturnType<typeof setup>>;

async function raiseRfi(s: Setup, subject: string, question: string, open: boolean) {
  const draft = await s.pm.browser.post(`${s.base}/rfis`, {
    subject,
    question,
    assigneeIds: [s.eng.userId],
  });
  expect(draft.statusCode).toBe(201);
  const rfi = draft.json().rfi;
  if (open) {
    const opened = await s.pm.browser.post(`${s.base}/rfis/${rfi.id}/open`, undefined, {
      'if-match': draft.headers.etag as string,
    });
    expect(opened.statusCode).toBe(200);
  }
  return rfi.id as string;
}

describe('Nova RFI drafts (F3)', () => {
  it('drafts from a note with references, similar RFIs and suggested assignees', async () => {
    const s = await setup();
    const asked = await raiseRfi(
      s,
      'Level 3 corridor wall fire rating at riser',
      'Which FRL governs the riser wall?',
      true,
    );
    // A draft nobody has sent isn't "already asked".
    await raiseRfi(s, 'Corridor wall fire rating', 'Draft only', false);
    await raiseRfi(s, 'Driveway pit location', 'Where does pit SW4 go?', true);

    const res = await s.pm.browser.post(`${s.base}/ai/rfi-drafts`, {
      note: 'Level 3 corridor wall at the riser: FRL 90/90/90 or 120/120/120? Which governs the fire rating',
    });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.runId).toMatch(/^air_/);
    expect(d.subject).toContain('Level 3 corridor wall');
    expect(d.discipline).toBe('fire');
    expect(d.references).toHaveLength(1);
    expect(d.references[0]).toMatchObject({
      sourceType: 'document',
      sourceId: s.documentId,
      reference: 'SPEC-0821',
      page: 1,
    });
    expect(d.unsupportedNumbers).toEqual([]);
    expect(d.similarRfis).toEqual([
      {
        id: asked,
        number: 'RFI-001',
        subject: 'Level 3 corridor wall fire rating at riser',
        status: 'open',
      },
    ]);
    expect(d.suggestedAssigneeIds).toEqual([s.eng.userId]);
    // The model saw the spec passage the PM can open.
    const call = t.ai.calls.at(-1)!;
    expect(call.task).toBe('rfi.draft');
    expect(call.passages.map((p) => p.text).join('\n')).toContain('FRL of 90/90/90');
    const usage = (await s.pm.browser.get(`/v1/orgs/${s.org.id}/ai/usage`)).json();
    // The note's embedding (free) and the draft (one credit).
    expect(usage.byFeature).toContainEqual({ feature: 'rfi_draft', credits: 1, runs: 2 });

    // A subcontractor only hears about RFIs they could open themselves.
    const fromSub = await s.sub.browser.post(`${s.base}/ai/rfi-drafts`, {
      note: 'Level 3 corridor wall at the riser: which fire rating governs',
    });
    expect(fromSub.statusCode).toBe(200);
    expect(fromSub.json()).toMatchObject({ similarRfis: [], suggestedAssigneeIds: [] });
  });

  it('lists numbers it cannot trace, drops invalid citations and needs RFI create access', async () => {
    const s = await setup();
    t.ai.on('rfi.draft', (req) => ({
      output: {
        subject: 'L3 corridor wall FRL',
        question: 'Please confirm the corridor wall achieves FRL 90/90/90 with a 13 mm board.',
        discipline: 'fire',
        references: [
          { passageId: req.passages[0]!.id, quote: 'achieve an FRL of 90/90/90' },
          { passageId: 'p99', quote: 'made up' },
        ],
        keywords: ['corridor wall'],
        gaps: ['impact'],
      },
    }));
    try {
      const d = (
        await s.pm.browser.post(`${s.base}/ai/rfi-drafts`, { note: 'L3 corridor wall rating?' })
      ).json();
      expect(d.unsupportedNumbers).toEqual(['13']);
      expect(d.references).toHaveLength(1);
      expect(d.references[0].quote).toBe('achieve an FRL of 90/90/90');
      expect(d.gaps).toEqual(['impact']);
      expect(d.similarRfis).toEqual([]);
      expect(d.suggestedAssigneeIds).toEqual([]);
    } finally {
      t.ai.on('rfi.draft', DEFAULT_FAKE_RESPONDERS['rfi.draft']!);
    }

    // Someone outside the project can't draft on it.
    const stranger = await signUp(t.app, 'rfid-stranger');
    const denied = await stranger.browser.post(`${s.base}/ai/rfi-drafts`, { note: 'Anything' });
    expect([403, 404]).toContain(denied.statusCode);
  });
});
