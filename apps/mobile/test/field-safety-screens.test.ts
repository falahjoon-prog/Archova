import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@archova/api-client';
import { mobileRoutes } from '@archova/routes';
import { TOOLS } from '../lib/tools';
import { createActionSender } from '../lib/actions/send';
import { canRespond, listRfis, respondToRfi, rfiSubtitle } from '../features/rfis';
import {
  attendeeSubtitle,
  encodeGreyPng,
  hasInk,
  rasteriseSignature,
  signAttendee,
  signaturePng,
  talkSubtitle,
  transitionTalk,
  uploadSignature,
} from '../features/toolbox';
import { acknowledgeSwms, needsReason, swmsSubtitle, transitionSwms } from '../features/swms';

vi.mock('../features/rfis/screens/RfisScreen', () => ({}));
vi.mock('../features/rfis/screens/RfiScreen', () => ({}));
vi.mock('../features/toolbox/screens/ToolboxScreen', () => ({}));
vi.mock('../features/toolbox/screens/ToolboxTalkScreen', () => ({}));
vi.mock('../features/swms/screens/SwmsRegisterScreen', () => ({}));
vi.mock('../features/swms/screens/SwmsScreen', () => ({}));

const fakeApi = (data: unknown = { data: [] }) => {
  const call = vi.fn(async (..._args: unknown[]) => ({
    data,
    response: { ok: true, status: 200 },
  }));
  return { api: { GET: call, POST: call, PUT: call, DELETE: call } as unknown as ApiClient, call };
};
const T = { orgId: 'org_1', projectId: 'prj_1' };

describe('tools and routes', () => {
  it('lists RFIs, toolbox talks and SWMS as tools inside the project', () => {
    for (const id of ['rfis', 'toolbox', 'swms']) {
      const tool = TOOLS.find((x) => x.id === id);
      expect(tool).toBeDefined();
      expect(tool!.route('prj_1')).toMatch(/^\/project\/prj_1\//);
    }
    expect(mobileRoutes.rfi('prj_1', 'rfi_1')).toBe('/project/prj_1/rfis/rfi_1');
    expect(mobileRoutes.toolboxTalk('prj_1', 'tbt_1')).toBe('/project/prj_1/toolbox/tbt_1');
    expect(mobileRoutes.swms('prj_1', 'sw_1')).toBe('/project/prj_1/swms/sw_1');
  });
});

describe('RFIs', () => {
  it('describes an RFI and who holds the ball', () => {
    const r = {
      numberLabel: 'RFI-007',
      status: 'open',
      ballInCourt: { side: 'assignees' },
      isOverdue: true,
      dueDate: '2026-11-01',
    };
    expect(rfiSubtitle(r)).toBe('RFI-007, Open, with the assignees, overdue');
    expect(canRespond(r)).toBe(true);
    expect(canRespond({ ...r, ballInCourt: { side: 'builder' } })).toBe(false);
    expect(canRespond({ ...r, status: 'closed' })).toBe(false);
  });

  it('filters the register by who the ball is with and overdue', async () => {
    const { api, call } = fakeApi();
    await listRfis(api, T, { q: ' slab ', mineUserId: 'usr_1', overdue: true });
    const init = call.mock.calls[0] as unknown as [string, { params: { query: unknown } }];
    expect(init[1].params.query).toEqual({
      limit: 50,
      q: 'slab',
      ballInCourt: 'usr_1',
      overdue: 'true',
    });
  });

  it('answers with an idempotency key and a trimmed body', async () => {
    const { api, call } = fakeApi({ rfi: {}, responses: [] });
    await respondToRfi(api, T, { rfiId: 'rfi_1', body: '  Use 32 MPa.  ', idempotencyKey: 'k1' });
    const init = call.mock.calls[0] as unknown as [
      string,
      { params: { header: unknown }; body: unknown },
    ];
    expect(init[1].params.header).toEqual({ 'Idempotency-Key': 'k1' });
    expect(init[1].body).toEqual({ body: 'Use 32 MPa.' });
  });

  it('replays a queued answer with the action id as its idempotency key', async () => {
    const { api, call } = fakeApi({});
    await createActionSender(
      api,
      'org_1',
    )({
      id: 'act_1',
      projectId: 'prj_1',
      kind: 'rfi.respond',
      targetId: 'rfi_1',
      payload: { body: 'Use 32 MPa.' },
      state: 'pending',
      lastError: null,
      attempts: 0,
      createdAt: '2026-11-18T00:00:00Z',
    });
    const init = call.mock.calls[0] as unknown as [
      string,
      { params: { header: unknown }; body: unknown },
    ];
    expect(init[1].params.header).toEqual({ 'Idempotency-Key': 'act_1' });
    expect(init[1].body).toEqual({ body: 'Use 32 MPa.' });
  });
});

describe('toolbox talks', () => {
  it('describes a talk and an attendance row', () => {
    expect(
      talkSubtitle({
        numberLabel: 'TBT-0004',
        status: 'open',
        attendeeCount: 5,
        signedCount: 3,
        heldAt: '2026-11-18T01:00:00Z',
      }),
    ).toBe('TBT-0004, Open, 3 of 5 signed, 2026-11-18');
    expect(attendeeSubtitle({ signedAt: null, repeatFlags: [] })).toBe('Not signed yet');
    expect(attendeeSubtitle({ signedAt: 'x', repeatFlags: ['shared_between_people'] })).toBe(
      'Signed. Same signature as someone else in this talk',
    );
  });

  it('rasterises strokes into a valid PNG', () => {
    const strokes = [
      [
        { x: 0.1, y: 0.5 },
        { x: 0.9, y: 0.5 },
      ],
    ];
    expect(hasInk([])).toBe(false);
    expect(hasInk(strokes)).toBe(true);
    const px = rasteriseSignature(strokes, 100, 40);
    expect(px.length).toBe(4000);
    expect(px[20 * 100 + 50]).toBe(0);
    expect(px[0]).toBe(255);
    const png = encodeGreyPng(px, 100, 40);
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(String.fromCharCode(...png.slice(12, 16))).toBe('IHDR');
    expect(String.fromCharCode(...png.slice(-8, -4))).toBe('IEND');
    // The image data is stored blocks, so the file is the pixels plus a small fixed overhead.
    expect(png.length).toBeGreaterThan(4040);
    expect(png.length).toBeLessThan(4200);
    expect(signaturePng(strokes)).not.toEqual(signaturePng([[{ x: 0.2, y: 0.2 }]]));
  });

  it('uploads the signature then signs the row with the stored file', async () => {
    const uploads = {
      createUpload: vi.fn(async (..._a: unknown[]) => ({
        id: 'upl_1',
        uploadUrl: 'https://s3/x',
        uploadHeaders: {},
      })),
      completeUpload: vi.fn(async () => ({ id: 'fil_1' })),
    };
    const transfer = { put: vi.fn(async () => ({ status: 200 })) };
    const file = await uploadSignature(uploads as never, transfer, {
      projectId: 'prj_1',
      idempotencyKey: 'k',
      image: {
        localUri: 'file:///s.png',
        filename: 's.png',
        sizeBytes: 10,
        sha256: 'a'.repeat(64),
      },
    });
    expect(file.id).toBe('fil_1');
    expect(uploads.createUpload.mock.calls[0]![0]).toMatchObject({
      mime: 'image/png',
      module: 'safety',
    });

    const { api, call } = fakeApi({});
    await signAttendee(api, T, { id: 'tbt_1', version: 3 }, 'att_1', 'fil_1');
    const init = call.mock.calls[0] as unknown as [
      string,
      { params: { header: unknown }; body: unknown },
    ];
    expect(init[1].params.header).toEqual({ 'If-Match': '"3"' });
    expect(init[1].body).toEqual({ signatureFileId: 'fil_1' });
  });

  it('stops when storage refuses the signature', async () => {
    const uploads = {
      createUpload: vi.fn(async () => ({ id: 'u', uploadUrl: 'x', uploadHeaders: {} })),
      completeUpload: vi.fn(),
    };
    await expect(
      uploadSignature(
        uploads as never,
        { put: async () => ({ status: 403 }) },
        {
          projectId: 'p',
          idempotencyKey: 'k',
          image: { localUri: 'f', filename: 'f', sizeBytes: 1, sha256: 'a'.repeat(64) },
        },
      ),
    ).rejects.toThrow('refused');
    expect(uploads.completeUpload).not.toHaveBeenCalled();
  });

  it('closes a talk with the version it was read at', async () => {
    const { api, call } = fakeApi({});
    await transitionTalk(api, T, { id: 'tbt_1', version: 2 }, 'close');
    const init = call.mock.calls[0] as unknown as [
      string,
      { params: { header: unknown }; body: unknown },
    ];
    expect(init[1].params.header).toEqual({ 'If-Match': '"2"' });
    expect(init[1].body).toEqual({ action: 'close' });
  });
});

describe('SWMS register', () => {
  it('describes a SWMS', () => {
    expect(
      swmsSubtitle({
        numberLabel: 'SWMS-0042',
        status: 'accepted',
        revision: 2,
        isExpired: true,
        expiresOn: '2026-10-01',
      }),
    ).toBe('SWMS-0042, Accepted, revision 2, expired');
    expect(needsReason('reject')).toBe(true);
    expect(needsReason('accept')).toBe(false);
  });

  it('acknowledges with the worker name and a key', async () => {
    const { api, call } = fakeApi({});
    await acknowledgeSwms(api, T, { swmsId: 'sw_1', workerName: ' Sam Lee ', idempotencyKey: 'k' });
    const init = call.mock.calls[0] as unknown as [
      string,
      { params: { header: unknown }; body: unknown },
    ];
    expect(init[1].params.header).toEqual({ 'Idempotency-Key': 'k' });
    expect(init[1].body).toEqual({ workerName: 'Sam Lee', language: 'en' });
  });

  it('confirms understandability only when accepting, and sends the reason when rejecting', async () => {
    const { api, call } = fakeApi({});
    await transitionSwms(api, T, { id: 'sw_1', version: 4 }, { action: 'accept' });
    await transitionSwms(
      api,
      T,
      { id: 'sw_1', version: 4 },
      { action: 'reject', reason: ' too vague ' },
    );
    const bodies = call.mock.calls.map(
      (c) => (c as unknown as [string, { body: unknown }])[1].body,
    );
    expect(bodies[0]).toEqual({ action: 'accept', confirmedUnderstandable: true });
    expect(bodies[1]).toEqual({ action: 'reject', reason: 'too vague' });
  });
});
