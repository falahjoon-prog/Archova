import { beforeEach, describe, expect, it, vi } from 'vitest';
import { carriedLabel, defaultHeldAt, localInputToIso } from '../lib/labels';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
const { createMeetingsApi } = await import('../data/api');

describe('labels', () => {
  it('words how often an item has been carried', () => {
    expect(carriedLabel(1)).toBe('Carried forward once');
    expect(carriedLabel(3)).toBe('Carried forward 3 times');
  });
  it('starts a new meeting at 9am local time, in the shape a datetime-local field takes', () => {
    expect(defaultHeldAt(new Date(2030, 2, 4, 15, 30))).toBe('2030-03-04T09:00');
    expect(localInputToIso('2030-03-04T09:00')).toBe(new Date(2030, 2, 4, 9, 0).toISOString());
  });
});

describe('meetings api', () => {
  beforeEach(() => fake.reset());

  it('sends the item version so a stale screen gets a 412 rather than overwriting', async () => {
    fake.on('PATCH', '/v1/orgs/{orgId}/projects/{projectId}/meeting-items/{itemId}', () => ({
      meeting: {},
    }));
    await createMeetingsApi('org_1').updateItem(
      'prj_1',
      { id: 'mit_1', version: 4 },
      { status: 'closed' },
    );
    const call = fake.calls.find((c) => c.method === 'PATCH')!;
    expect(call.init.params?.header).toEqual({ 'If-Match': '"4"' });
    expect(call.init.params?.path).toMatchObject({ itemId: 'mit_1' });
    expect(call.init.body).toEqual({ status: 'closed' });
  });

  it('turns the base64 PDF into a file the browser can save', async () => {
    fake.on(
      'GET',
      '/v1/orgs/{orgId}/projects/{projectId}/meetings/{meetingId}/versions/{version}/pdf',
      () => ({
        filename: 'Site-1-v2.pdf',
        contentType: 'application/pdf',
        dataBase64: btoa('%PDF-1.7'),
      }),
    );
    const file = await createMeetingsApi('org_1').pdf('prj_1', 'mtg_1', 2);
    expect(file.name).toBe('Site-1-v2.pdf');
    expect(file.type).toBe('application/pdf');
    expect(await file.text()).toBe('%PDF-1.7');
    expect(fake.calls[0]!.init.params?.path).toMatchObject({ version: '2' });
  });

  it('asks Nova for items from the notes and reads them from the suggestion payload', async () => {
    fake.on(
      'POST',
      '/v1/orgs/{orgId}/projects/{projectId}/meetings/{meetingId}/nova-minutes',
      () => ({
        id: 'ais_1',
        task: 'minutes.extract',
        payload: {
          meetingId: 'mtg_1',
          dropped: 1,
          items: [
            {
              kind: 'action',
              text: 'Confirm the permit',
              quote: 'Confirm the permit',
              sectionId: null,
              attendeeId: null,
              dueDate: null,
            },
          ],
        },
      }),
    );
    const draft = await createMeetingsApi('org_1').draftMinutes(
      'prj_1',
      'mtg_1',
      'Confirm the permit',
    );
    expect(draft).toMatchObject({ suggestionId: 'ais_1', dropped: 1 });
    expect(draft.items).toHaveLength(1);
    const call = fake.calls.find((c) => c.method === 'POST')!;
    expect(call.init.body).toEqual({ notes: 'Confirm the permit' });
    expect(call.init.params?.path).toMatchObject({ meetingId: 'mtg_1' });
  });

  it('records the draft as used or not with the suggestion decision', async () => {
    fake.on(
      'POST',
      '/v1/orgs/{orgId}/projects/{projectId}/ai/suggestions/{suggestionId}/decision',
      () => ({
        id: 'ais_1',
      }),
    );
    await createMeetingsApi('org_1').decideDraft('prj_1', 'ais_1', 'accepted');
    const call = fake.calls.find((c) => c.method === 'POST')!;
    expect(call.init.body).toEqual({ decision: 'accepted' });
    expect(call.init.params?.path).toMatchObject({ suggestionId: 'ais_1' });
  });
});
