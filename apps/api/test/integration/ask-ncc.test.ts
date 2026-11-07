import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@archova/domain';
import {
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
afterAll(async () => {
  await t.adminDb.pool.query('delete from ai.ai_ncc_provisions');
  await t.close();
});

const provision = (status: 'signed' | 'draft') =>
  t.adminDb.pool.query(
    `insert into ai.ai_ncc_provisions
       (id, provision_key, version, edition, volume, clause, title, summary, url, keywords, status, signed_by, signed_on)
     values ($1, $2, 1, '2022', '1', $3, 'Fire resistance of building elements',
       'Which fire resistance level an element must achieve.', 'https://ncc.abcb.gov.au/editions/ncc-2022',
       array['fire resistance'], $4, $5, $6)`,
    [
      uuidv7(),
      `fire_${status}`,
      status === 'signed' ? 'C2D2' : 'DRAFT1',
      status,
      status === 'signed' ? 'Grace' : null,
      status === 'signed' ? '2026-11-05' : null,
    ],
  );

describe('Ask Nova NCC references', () => {
  it('attaches a signed provision, never a draft, and nothing for an unrelated question', async () => {
    const owner = await signUp(t.app, 'ncc-owner');
    const org = await createOrg(owner.browser, 'Ncc Builders');
    const project = await createProject(owner.browser, org.id, {
      name: 'Harbourside',
      state: 'NSW',
    });
    const base = `/v1/orgs/${org.id}/projects/${project.id}`;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc
      .addPage([595, 842])
      .drawText(
        'Walls to the Level 3 corridor shall achieve a fire resistance level of 90/90/90.',
        {
          x: 50,
          y: 780,
          size: 11,
          font,
        },
      );
    const folder = (await owner.browser.post(`${base}/folders`, { name: 'Specifications' })).json();
    const fileId = await uploadBytes(t, owner.browser, org.id, project.id, await doc.save());
    expect(
      (
        await owner.browser.post(`${base}/documents`, {
          folderId: folder.id,
          title: 'Fire Protection Specification',
          docNumber: 'SPEC-0821',
          revision: { rev: 'A', fileId },
        })
      ).statusCode,
    ).toBe(201);
    await owner.browser.post(`${base}/ai/index`);
    const question = 'What fire resistance level applies to the Level 3 corridor walls?';

    // An empty table changes nothing.
    const before = (await owner.browser.post(`${base}/ai/ask`, { question })).json();
    expect(before.found).toBe(true);
    expect(before.nccReferences).toEqual([]);
    expect(before.nccNote).toBeUndefined();

    await provision('draft');
    expect((await owner.browser.post(`${base}/ai/ask`, { question })).json().nccReferences).toEqual(
      [],
    );

    await provision('signed');
    const after = (await owner.browser.post(`${base}/ai/ask`, { question })).json();
    expect(after.nccReferences).toHaveLength(1);
    expect(after.nccReferences[0]).toMatchObject({
      edition: '2022',
      volume: '1',
      clause: 'C2D2',
      signedBy: 'Grace',
    });
    expect(after.nccNote).toContain('not advice');
    // The model was never asked for a clause number.
    expect(JSON.stringify(t.ai.calls.at(-1))).not.toContain('C2D2');
  });
});
