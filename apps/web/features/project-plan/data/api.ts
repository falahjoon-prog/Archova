import { unwrap } from '@archova/api-client';
import { api } from '@/shared/lib/api';
import type {
  ItemType,
  ItemStatus,
  LinkType,
  PlanInsights,
  PlanLinkOption,
  ProjectPlan,
} from '../lib/labels';
import type { components } from '@archova/contracts/openapi';

const P = '/v1/orgs/{orgId}/projects/{projectId}/project-plan' as const;
type S = components['schemas'];

export type ItemPatch = S['UpdatePlanItemRequest'];
export type NewItem = S['CreatePlanItemRequest'];
export type { ItemType, ItemStatus, LinkType };

/** The live project plan API. Every write answers with the whole plan, so the screen shows what the server kept. */
export function createProjectPlanApi(orgId: string) {
  const path = (projectId: string) => ({ orgId, projectId });
  return {
    async get(projectId: string): Promise<ProjectPlan> {
      return unwrap(await api.GET(P, { params: { path: path(projectId) } }));
    },
    async start(projectId: string): Promise<ProjectPlan> {
      return unwrap(await api.POST(P, { params: { path: path(projectId) } }));
    },
    async insights(projectId: string): Promise<PlanInsights> {
      return unwrap(await api.GET(`${P}/insights`, { params: { path: path(projectId) } }));
    },
    async addPhase(projectId: string, title: string): Promise<ProjectPlan> {
      return unwrap(
        await api.POST(`${P}/phases`, { params: { path: path(projectId) }, body: { title } }),
      );
    },
    async updatePhase(
      projectId: string,
      phaseId: string,
      body: { title?: string; position?: number },
    ): Promise<ProjectPlan> {
      return unwrap(
        await api.PATCH(`${P}/phases/{phaseId}`, {
          params: { path: { ...path(projectId), phaseId } },
          body,
        }),
      );
    },
    async deletePhase(projectId: string, phaseId: string): Promise<ProjectPlan> {
      return unwrap(
        await api.DELETE(`${P}/phases/{phaseId}`, {
          params: { path: { ...path(projectId), phaseId } },
        }),
      );
    },
    async phaseSummary(projectId: string, phaseId: string): Promise<string> {
      return unwrap(
        await api.POST(`${P}/phases/{phaseId}/summary`, {
          params: { path: { ...path(projectId), phaseId } },
        }),
      ).text;
    },
    async addItem(projectId: string, phaseId: string, body: NewItem): Promise<ProjectPlan> {
      return unwrap(
        await api.POST(`${P}/phases/{phaseId}/items`, {
          params: { path: { ...path(projectId), phaseId } },
          body,
        }),
      );
    },
    async updateItem(projectId: string, itemId: string, body: ItemPatch): Promise<ProjectPlan> {
      return unwrap(
        await api.PATCH(`${P}/items/{itemId}`, {
          params: { path: { ...path(projectId), itemId } },
          body,
        }),
      );
    },
    async deleteItem(projectId: string, itemId: string): Promise<ProjectPlan> {
      return unwrap(
        await api.DELETE(`${P}/items/{itemId}`, {
          params: { path: { ...path(projectId), itemId } },
        }),
      );
    },
    async clearHold(projectId: string, itemId: string, note?: string): Promise<ProjectPlan> {
      return unwrap(
        await api.POST(`${P}/items/{itemId}/clear-hold`, {
          params: { path: { ...path(projectId), itemId } },
          body: note ? { note } : {},
        }),
      );
    },
    async linkOptions(
      projectId: string,
      itemId: string,
      type: LinkType,
      q?: string,
    ): Promise<{ data: PlanLinkOption[]; restricted: boolean }> {
      return unwrap(
        await api.GET(`${P}/items/{itemId}/link-options`, {
          params: { path: { ...path(projectId), itemId }, query: { type, ...(q ? { q } : {}) } },
        }),
      );
    },
    async request(
      projectId: string,
      itemId: string,
      body: { kind: 'attachment' | 'photo'; message?: string; assigneeUserId?: string },
    ): Promise<ProjectPlan> {
      return unwrap(
        await api.POST(`${P}/items/{itemId}/requests`, {
          params: { path: { ...path(projectId), itemId } },
          body,
        }),
      );
    },
  };
}
export type ProjectPlanApi = ReturnType<typeof createProjectPlanApi>;
