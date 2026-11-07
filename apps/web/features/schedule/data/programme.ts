// The programme (schedules, activities, links, look-ahead) against its endpoints (product/08 S4, S5).

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

type S = components['schemas'];
export type ScheduleSummary = S['ScheduleSummary'];
export type ScheduleDetail = S['ScheduleDetail'];
export type ScheduleActivity = S['ScheduleActivity'];
export type ScheduleDependency = S['ScheduleDependency'];
export type ScheduleLookahead = S['ScheduleLookahead'];
export type CreateActivity = S['CreateScheduleActivityRequest'];
export type UpdateActivity = S['UpdateScheduleActivityRequest'];
export type CreateDependency = S['CreateScheduleDependencyRequest'];
export type ImportRequest = S['ImportScheduleRequest'];
export type ScheduleLink = S['ScheduleLink'];
export type ItemPlacement = S['ScheduleItemPlacement'];
export type DepType = S['ScheduleDepType'];

const P = '/v1/orgs/{orgId}/projects/{projectId}/schedules' as const;

export function createProgrammeApi(orgId: string) {
  const path = (projectId: string, scheduleId: string) => ({
    path: { orgId, projectId, scheduleId },
  });
  return {
    async list(projectId: string): Promise<ScheduleSummary[]> {
      return unwrap(await api.GET(P, { params: { path: { orgId, projectId } } })).data;
    },
    async create(projectId: string, name: string): Promise<ScheduleDetail> {
      return unwrap(await api.POST(P, { params: { path: { orgId, projectId } }, body: { name } }));
    },
    async importFile(projectId: string, body: ImportRequest) {
      return unwrap(
        await api.POST(`${P}/import`, { params: { path: { orgId, projectId } }, body }),
      );
    },
    async get(projectId: string, scheduleId: string): Promise<ScheduleDetail> {
      return unwrap(await api.GET(`${P}/{scheduleId}`, { params: path(projectId, scheduleId) }));
    },
    async remove(projectId: string, scheduleId: string): Promise<void> {
      unwrap(await api.DELETE(`${P}/{scheduleId}`, { params: path(projectId, scheduleId) }));
    },
    async createActivity(projectId: string, scheduleId: string, body: CreateActivity) {
      return unwrap(
        await api.POST(`${P}/{scheduleId}/activities`, {
          params: path(projectId, scheduleId),
          body,
        }),
      );
    },
    async updateActivity(
      projectId: string,
      scheduleId: string,
      activityId: string,
      body: UpdateActivity,
    ) {
      return unwrap(
        await api.PATCH(`${P}/{scheduleId}/activities/{activityId}`, {
          params: { path: { orgId, projectId, scheduleId, activityId } },
          body,
        }),
      );
    },
    async setBaseline(projectId: string, scheduleId: string): Promise<ScheduleDetail> {
      return unwrap(
        await api.PUT(`${P}/{scheduleId}/baseline`, { params: path(projectId, scheduleId) }),
      );
    },
    async clearBaseline(projectId: string, scheduleId: string): Promise<ScheduleDetail> {
      return unwrap(
        await api.DELETE(`${P}/{scheduleId}/baseline`, { params: path(projectId, scheduleId) }),
      );
    },
    async deleteActivity(projectId: string, scheduleId: string, activityId: string) {
      return unwrap(
        await api.DELETE(`${P}/{scheduleId}/activities/{activityId}`, {
          params: { path: { orgId, projectId, scheduleId, activityId } },
        }),
      );
    },
    async createDependency(projectId: string, scheduleId: string, body: CreateDependency) {
      return unwrap(
        await api.POST(`${P}/{scheduleId}/dependencies`, {
          params: path(projectId, scheduleId),
          body,
        }),
      );
    },
    async deleteDependency(projectId: string, scheduleId: string, dependencyId: string) {
      return unwrap(
        await api.DELETE(`${P}/{scheduleId}/dependencies/{dependencyId}`, {
          params: { path: { orgId, projectId, scheduleId, dependencyId } },
        }),
      );
    },
    async listLinks(projectId: string, scheduleId: string): Promise<ScheduleLink[]> {
      return unwrap(
        await api.GET(`${P}/{scheduleId}/links`, { params: path(projectId, scheduleId) }),
      ).data;
    },
    async placements(
      projectId: string,
      kind: 'rfi' | 'submittal',
      targetId: string,
    ): Promise<ItemPlacement[]> {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/projects/{projectId}/schedule-links', {
          params: { path: { orgId, projectId }, query: { kind, targetId } },
        }),
      ).data;
    },
    async createLink(
      projectId: string,
      scheduleId: string,
      activityId: string,
      body: { kind: 'rfi' | 'submittal'; targetId: string },
    ): Promise<ScheduleLink> {
      return unwrap(
        await api.POST(`${P}/{scheduleId}/activities/{activityId}/links`, {
          params: { path: { orgId, projectId, scheduleId, activityId } },
          body,
        }),
      );
    },
    async deleteLink(projectId: string, scheduleId: string, linkId: string) {
      unwrap(
        await api.DELETE(`${P}/{scheduleId}/links/{linkId}`, {
          params: { path: { orgId, projectId, scheduleId, linkId } },
        }),
      );
    },
    async lookahead(
      projectId: string,
      scheduleId: string,
      weeks: number,
    ): Promise<ScheduleLookahead> {
      return unwrap(
        await api.GET(`${P}/{scheduleId}/lookahead`, {
          params: { ...path(projectId, scheduleId), query: { weeks } },
        }),
      );
    },
  };
}
