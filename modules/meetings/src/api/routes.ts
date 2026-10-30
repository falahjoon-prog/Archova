import { decodeId, type IdKind } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  etag,
  parseIfMatch,
  requireTenant,
  type Database,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { IssueNotice, MeetingService } from '../application/meetings';

const ref = (kind: IdKind, value: string, path: string) => {
  const uuid = decodeId(kind, value);
  if (!uuid)
    throw new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
  return uuid;
};

const project = (p: { projectId: string }) => {
  const id = decodeId('project', p.projectId);
  if (!id) throw new AppError('project.not_found');
  return id;
};
const meetingId = (p: { meetingId: string }) => {
  const id = decodeId('meeting', p.meetingId);
  if (!id) throw new AppError('meeting.not_found');
  return id;
};
const seriesId = (p: { seriesId: string }) => {
  const id = decodeId('meetingSeries', p.seriesId);
  if (!id) throw new AppError('meeting.series_not_found');
  return id;
};
const itemId = (p: { itemId: string }) => {
  const id = decodeId('meetingItem', p.itemId);
  if (!id) throw new AppError('meeting.item_not_found');
  return id;
};

export function meetingsRoutes(
  database: Database,
  meetings: MeetingService,
  /** Called after the issue transaction commits, so a slow mail server never holds the database. */
  notify: (notice: IssueNotice) => Promise<void>,
) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const ok = (status: number, body: Awaited<ReturnType<MeetingService['detail']>>) => ({
    status,
    body,
    headers: { etag: etag(body.meeting.version) },
  });

  return defineRoutes({
    listMeetingSeries: async (input) => ({
      status: 200,
      body: await read(input, (s) => meetings.listSeries(s, project(input.params))),
    }),
    createMeetingSeries: async (input) => {
      const body = await tx(input, (s) =>
        meetings.createSeries(s, project(input.params), input.body),
      );
      return { status: 201, body, headers: { etag: etag(body.version) } };
    },
    updateMeetingSeries: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const body = await tx(input, (s) =>
        meetings.updateSeries(
          s,
          project(input.params),
          seriesId(input.params),
          expected,
          input.body,
        ),
      );
      return { status: 200, body, headers: { etag: etag(body.version) } };
    },
    createMeeting: async (input) =>
      ok(
        201,
        await tx(input, (s) =>
          meetings.createMeeting(s, project(input.params), seriesId(input.params), input.body),
        ),
      ),
    listMeetings: async (input) => ({
      status: 200,
      body: await read(input, (s) =>
        meetings.list(
          s,
          project(input.params),
          input.query.seriesId ? ref('meetingSeries', input.query.seriesId, 'seriesId') : undefined,
        ),
      ),
    }),
    getMeeting: async (input) =>
      ok(
        200,
        await read(input, (s) =>
          meetings.detail(s, project(input.params), meetingId(input.params)),
        ),
      ),
    updateMeeting: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return ok(
        200,
        await tx(input, (s) =>
          meetings.updateMeeting(
            s,
            project(input.params),
            meetingId(input.params),
            expected,
            input.body,
          ),
        ),
      );
    },
    setMeetingAttendees: async (input) =>
      ok(
        200,
        await tx(input, (s) =>
          meetings.setAttendees(s, project(input.params), meetingId(input.params), input.body),
        ),
      ),
    addMeetingSection: async (input) =>
      ok(
        201,
        await tx(input, (s) =>
          meetings.addSection(s, project(input.params), meetingId(input.params), input.body),
        ),
      ),
    createMeetingItem: async (input) =>
      ok(
        201,
        await tx(input, (s) =>
          meetings.createItem(s, project(input.params), meetingId(input.params), input.body),
        ),
      ),
    updateMeetingItem: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return ok(
        200,
        await tx(input, (s) =>
          meetings.updateItem(s, project(input.params), itemId(input.params), expected, input.body),
        ),
      );
    },
    deleteMeetingItem: async (input) =>
      ok(
        200,
        await tx(input, (s) => meetings.deleteItem(s, project(input.params), itemId(input.params))),
      ),
    issueMeeting: async (input) => {
      const { detail, notice } = await tx(input, (s) =>
        meetings.issue(s, project(input.params), meetingId(input.params), input.body),
      );
      await notify(notice);
      return ok(200, detail);
    },
    getMeetingMinutesPdf: async (input) => ({
      status: 200,
      body: await read(input, (s) =>
        meetings.pdf(
          s,
          project(input.params),
          meetingId(input.params),
          Number(input.params.version),
        ),
      ),
    }),
    listMeetingActions: async (input) => ({
      status: 200,
      body: await read(input, (s) =>
        meetings.actions(s, project(input.params), input.query.scope ?? 'mine'),
      ),
    }),
  });
}
