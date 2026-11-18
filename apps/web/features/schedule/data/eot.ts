// Delay events and EOT claims (scheduling) against their endpoints (product/08 SCH-AC3..5).

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

type S = components['schemas'];
export type EotSettings = S['EotSettings'];
export type PutEotSettings = S['PutEotSettingsRequest'];
export type DelayEvent = S['DelayEvent'];
export type DelayEventDetail = S['DelayEventDetail'];
export type DelayEventItem = S['DelayEventItem'];
export type DelayEventStatus = S['DelayEventStatus'];
export type DelayEventClock = S['DelayEventClock'];
export type DelayEventFlag = S['DelayEventFlag'];
export type DelayEventInsights = S['DelayEventInsights'];
export type DelayEventCandidate = S['DelayEventCandidate'];
export type DelayEventCandidateList = S['DelayEventCandidateList'];
export type DelayEventDraft = S['DelayEventDraft'];
export type CreateDelayEvent = S['CreateDelayEventRequest'];
export type UpdateDelayEvent = S['UpdateDelayEventRequest'];
export type AddEvidence = S['AddDelayEventEvidenceRequest'];
export type EventTransition = S['DelayEventTransitionRequest'];
export type DraftKind = S['DelayEventDraftRequest']['kind'];

const P = '/v1/orgs/{orgId}/projects/{projectId}' as const;
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export function createEotApi(orgId: string) {
  const path = (projectId: string) => ({ orgId, projectId });
  const withEvent = (projectId: string, eventId: string) => ({ ...path(projectId), eventId });
  return {
    async settings(projectId: string): Promise<EotSettings> {
      return unwrap(await api.GET(`${P}/eot-settings`, { params: { path: path(projectId) } }));
    },
    async putSettings(projectId: string, body: PutEotSettings): Promise<EotSettings> {
      return unwrap(
        await api.PUT(`${P}/eot-settings`, { params: { path: path(projectId) }, body }),
      );
    },
    async candidates(projectId: string): Promise<DelayEventCandidateList> {
      return unwrap(
        await api.GET(`${P}/delay-event-candidates`, { params: { path: path(projectId) } }),
      );
    },
    async insights(projectId: string): Promise<DelayEventInsights> {
      return unwrap(
        await api.GET(`${P}/delay-event-insights`, { params: { path: path(projectId) } }),
      );
    },
    async list(projectId: string): Promise<DelayEvent[]> {
      return unwrap(await api.GET(`${P}/delay-events`, { params: { path: path(projectId) } })).data;
    },
    async get(projectId: string, eventId: string): Promise<DelayEventDetail> {
      return unwrap(
        await api.GET(`${P}/delay-events/{eventId}`, {
          params: { path: withEvent(projectId, eventId) },
        }),
      );
    },
    async create(projectId: string, body: CreateDelayEvent): Promise<DelayEvent> {
      return unwrap(
        await api.POST(`${P}/delay-events`, {
          params: { path: path(projectId), header: idempotencyKey() },
          body,
        }),
      );
    },
    async update(projectId: string, eventId: string, body: UpdateDelayEvent): Promise<DelayEvent> {
      return unwrap(
        await api.PATCH(`${P}/delay-events/{eventId}`, {
          params: { path: withEvent(projectId, eventId) },
          body,
        }),
      );
    },
    async addEvidence(
      projectId: string,
      eventId: string,
      body: AddEvidence,
    ): Promise<DelayEventDetail> {
      return unwrap(
        await api.POST(`${P}/delay-events/{eventId}/evidence`, {
          params: { path: withEvent(projectId, eventId) },
          body,
        }),
      );
    },
    async removeEvidence(projectId: string, eventId: string, itemId: string): Promise<void> {
      unwrap(
        await api.DELETE(`${P}/delay-events/{eventId}/evidence/{itemId}`, {
          params: { path: { ...withEvent(projectId, eventId), itemId } },
        }),
      );
    },
    async transition(
      projectId: string,
      eventId: string,
      body: EventTransition,
    ): Promise<DelayEvent> {
      return unwrap(
        await api.POST(`${P}/delay-events/{eventId}/transitions`, {
          params: { path: withEvent(projectId, eventId) },
          body,
        }),
      );
    },
    async draft(
      projectId: string,
      eventId: string,
      body: S['DelayEventDraftRequest'],
    ): Promise<DelayEventDraft> {
      return unwrap(
        await api.POST(`${P}/delay-events/{eventId}/drafts`, {
          params: { path: withEvent(projectId, eventId) },
          body,
        }),
      );
    },
  };
}
