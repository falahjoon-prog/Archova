import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';
import { uploadFile } from '@/shared/lib/uploads';
import type { Attendee, Suggestion, Talk, TalkDetail, Topic } from '../lib/types';
import type { ToolboxSource } from './source';

type ApiTopic = components['schemas']['ToolboxTopic'];
type ApiTalk = components['schemas']['ToolboxTalk'];
type ApiDetail = components['schemas']['ToolboxTalkDetail'];
type ApiAttendee = components['schemas']['ToolboxAttendee'];

const P = '/v1/orgs/{orgId}/projects/{projectId}' as const;
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export const toTopic = (t: ApiTopic): Topic => ({
  id: t.id,
  title: t.title,
  talkingPoints: t.talkingPoints,
  category: t.category,
  hrcwCategory: t.hrcwCategory,
  isActive: t.isActive,
  lastHeldAt: t.lastHeldAt,
  version: t.version,
});

export const toTalk = (t: ApiTalk): Talk => ({
  id: t.id,
  numberLabel: t.numberLabel,
  topicId: t.topicId,
  title: t.title,
  heldAt: t.heldAt,
  location: t.location,
  presenterName: t.presenterName,
  notes: t.notes,
  status: t.status,
  closedAt: t.closedAt,
  attendeeCount: t.attendeeCount,
  signedCount: t.signedCount,
  version: t.version,
});

const toAttendee = (a: ApiAttendee): Attendee => ({
  id: a.id,
  personName: a.personName,
  companyId: a.companyId,
  signedAt: a.signedAt,
  signatureFileId: a.signatureFileId,
  repeatFlags: a.repeatFlags,
});

export const toDetail = (d: ApiDetail): TalkDetail => ({
  talk: toTalk(d.talk),
  topic: d.topic ? toTopic(d.topic) : null,
  attendees: d.attendees.map(toAttendee),
  closeBlockers: d.closeBlockers,
  canEdit: d.canEdit,
});

export function createToolboxApi(orgId: string): ToolboxSource {
  const talkPath = (projectId: string, talkId: string) => ({ orgId, projectId, talkId });
  return {
    async listTalks(projectId) {
      const r = unwrap(
        await api.GET(`${P}/toolbox-talks`, {
          params: { path: { orgId, projectId }, query: { limit: 100 } },
        }),
      );
      return r.data.map(toTalk);
    },
    async getTalk(projectId, id) {
      return toDetail(
        unwrap(
          await api.GET(`${P}/toolbox-talks/{talkId}`, {
            params: { path: talkPath(projectId, id) as never },
          }),
        ),
      );
    },
    async createTalk(projectId, input) {
      return toDetail(
        unwrap(
          await api.POST(`${P}/toolbox-talks`, {
            params: { path: { orgId, projectId }, header: idempotencyKey() },
            body: {
              title: input.title,
              heldAt: input.heldAt,
              presenterName: input.presenterName,
              ...(input.topicId ? { topicId: input.topicId } : {}),
              ...(input.location ? { location: input.location } : {}),
              ...(input.attendees?.length ? { attendees: input.attendees } : {}),
            },
          }),
        ),
      );
    },
    async transition(projectId, d, action) {
      return toDetail(
        unwrap(
          await api.POST(`${P}/toolbox-talks/{talkId}/transition`, {
            params: { path: talkPath(projectId, d.talk.id), header: ifMatch(d.talk.version) },
            body: { action },
          } as never),
        ) as ApiDetail,
      );
    },
    async addAttendees(projectId, d, people) {
      return toDetail(
        unwrap(
          await api.POST(`${P}/toolbox-talks/{talkId}/attendees`, {
            params: { path: talkPath(projectId, d.talk.id), header: ifMatch(d.talk.version) },
            body: { attendees: people },
          } as never),
        ) as ApiDetail,
      );
    },
    async removeAttendee(projectId, d, attendeeId) {
      return toDetail(
        unwrap(
          await api.DELETE(`${P}/toolbox-talks/{talkId}/attendees/{attendeeId}`, {
            params: {
              path: { ...talkPath(projectId, d.talk.id), attendeeId },
              header: ifMatch(d.talk.version),
            },
          } as never),
        ) as ApiDetail,
      );
    },
    async sign(projectId, d, attendeeId, image) {
      const file = await uploadFile(orgId, {
        file: new File([image], `signature-${attendeeId}.png`, { type: 'image/png' }),
        projectId,
        module: 'safety',
      });
      return toDetail(
        unwrap(
          await api.PUT(`${P}/toolbox-talks/{talkId}/attendees/{attendeeId}/signature`, {
            params: {
              path: { ...talkPath(projectId, d.talk.id), attendeeId },
              header: ifMatch(d.talk.version),
            },
            body: { signatureFileId: file.id },
          } as never),
        ) as ApiDetail,
      );
    },
    async clearSignature(projectId, d, attendeeId) {
      return toDetail(
        unwrap(
          await api.DELETE(`${P}/toolbox-talks/{talkId}/attendees/{attendeeId}/signature`, {
            params: {
              path: { ...talkPath(projectId, d.talk.id), attendeeId },
              header: ifMatch(d.talk.version),
            },
          } as never),
        ) as ApiDetail,
      );
    },
    async listTopics(projectId) {
      const r = unwrap(
        await api.GET(`${P}/toolbox-topics`, {
          params: { path: { orgId, projectId }, query: { includeInactive: 'true' } },
        }),
      );
      return r.data.map(toTopic);
    },
    async createTopic(projectId, input) {
      return toTopic(
        unwrap(
          await api.POST(`${P}/toolbox-topics`, {
            params: { path: { orgId, projectId }, header: idempotencyKey() },
            body: input,
          }),
        ),
      );
    },
    async setTopicActive(projectId, topic, isActive) {
      return toTopic(
        unwrap(
          await api.PATCH(`${P}/toolbox-topics/{topicId}`, {
            params: {
              path: { orgId, projectId, topicId: topic.id },
              header: ifMatch(topic.version),
            },
            body: { isActive },
          } as never),
        ) as ApiTopic,
      );
    },
    async suggestions(projectId) {
      const r = unwrap(
        await api.GET(`${P}/toolbox-talks/suggestions`, {
          params: { path: { orgId, projectId } },
        }),
      );
      return r.data.map<Suggestion>((s) => ({ ...s }));
    },
  };
}
