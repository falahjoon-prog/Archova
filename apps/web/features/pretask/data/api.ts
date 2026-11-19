import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';
import { uploadFile } from '@/shared/lib/uploads';
import type { CrewMember, Plan, PlanDetail, Suggestion } from '../lib/types';
import type { PretaskSource } from './source';

type ApiPlan = components['schemas']['PretaskPlan'];
type ApiDetail = components['schemas']['PretaskPlanDetail'];
type ApiCrew = components['schemas']['PretaskCrew'];

const P = '/v1/orgs/{orgId}/projects/{projectId}' as const;
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export const toPlan = (p: ApiPlan): Plan => ({
  id: p.id,
  numberLabel: p.numberLabel,
  taskTitle: p.taskTitle,
  workDate: p.workDate,
  location: p.location,
  companyId: p.companyId,
  swmsId: p.swmsId,
  supervisorName: p.supervisorName,
  hazards: p.hazards,
  status: p.status,
  closedAt: p.closedAt,
  reviewedAt: p.reviewedAt,
  reviewNote: p.reviewNote,
  crewCount: p.crewCount,
  signedCount: p.signedCount,
  version: p.version,
});

const toCrew = (c: ApiCrew): CrewMember => ({
  id: c.id,
  personName: c.personName,
  companyId: c.companyId,
  signedAt: c.signedAt,
  signatureFileId: c.signatureFileId,
  inductionStatus: c.inductionStatus ?? null,
  swmsRead: c.swmsRead,
});

export const toDetail = (d: ApiDetail): PlanDetail => ({
  plan: toPlan(d.plan),
  crew: d.crew.map(toCrew),
  swms: d.swms
    ? {
        id: d.swms.id,
        numberLabel: d.swms.numberLabel,
        title: d.swms.title,
        status: d.swms.status,
        expired: d.swms.expired,
      }
    : null,
  closeBlockers: d.closeBlockers,
  warnings: d.warnings,
  events: d.events.map((e) => ({ id: e.id, action: e.action, note: e.note, at: e.at })),
  canEdit: d.canEdit,
  canReview: d.canReview,
});

export function createPretaskApi(orgId: string): PretaskSource {
  const planPath = (projectId: string, planId: string) => ({ orgId, projectId, planId });
  const crewPath = (projectId: string, planId: string, crewId: string) => ({
    ...planPath(projectId, planId),
    crewId,
  });
  return {
    async listPlans(projectId) {
      const r = unwrap(
        await api.GET(`${P}/pretask-plans`, {
          params: { path: { orgId, projectId }, query: { limit: 100 } },
        }),
      );
      return r.data.map(toPlan);
    },
    async getPlan(projectId, id) {
      return toDetail(
        unwrap(
          await api.GET(`${P}/pretask-plans/{planId}`, {
            params: { path: planPath(projectId, id) as never },
          }),
        ),
      );
    },
    async createPlan(projectId, input) {
      return toDetail(
        unwrap(
          await api.POST(`${P}/pretask-plans`, {
            params: { path: { orgId, projectId }, header: idempotencyKey() },
            body: {
              taskTitle: input.taskTitle,
              workDate: input.workDate,
              supervisorName: input.supervisorName,
              hazards: input.hazards,
              ...(input.location ? { location: input.location } : {}),
              ...(input.companyId ? { companyId: input.companyId } : {}),
              ...(input.swmsId ? { swmsId: input.swmsId } : {}),
              ...(input.crew.length ? { crew: input.crew } : {}),
            },
          }),
        ),
      );
    },
    async setHazards(projectId, d, hazards) {
      return toDetail(
        unwrap(
          await api.PATCH(`${P}/pretask-plans/{planId}`, {
            params: { path: planPath(projectId, d.plan.id), header: ifMatch(d.plan.version) },
            body: { hazards },
          } as never),
        ) as ApiDetail,
      );
    },
    async transition(projectId, d, action) {
      return toDetail(
        unwrap(
          await api.POST(`${P}/pretask-plans/{planId}/transition`, {
            params: { path: planPath(projectId, d.plan.id), header: ifMatch(d.plan.version) },
            body: { action },
          } as never),
        ) as ApiDetail,
      );
    },
    async review(projectId, d, note) {
      return toDetail(
        unwrap(
          await api.POST(`${P}/pretask-plans/{planId}/review`, {
            params: { path: planPath(projectId, d.plan.id), header: ifMatch(d.plan.version) },
            body: { note },
          } as never),
        ) as ApiDetail,
      );
    },
    async addCrew(projectId, d, people) {
      return toDetail(
        unwrap(
          await api.POST(`${P}/pretask-plans/{planId}/crew`, {
            params: { path: planPath(projectId, d.plan.id), header: ifMatch(d.plan.version) },
            body: { crew: people },
          } as never),
        ) as ApiDetail,
      );
    },
    async removeCrew(projectId, d, crewId) {
      return toDetail(
        unwrap(
          await api.DELETE(`${P}/pretask-plans/{planId}/crew/{crewId}`, {
            params: {
              path: crewPath(projectId, d.plan.id, crewId),
              header: ifMatch(d.plan.version),
            },
          } as never),
        ) as ApiDetail,
      );
    },
    async sign(projectId, d, crewId, image) {
      const file = await uploadFile(orgId, {
        file: new File([image], `signature-${crewId}.png`, { type: 'image/png' }),
        projectId,
        module: 'safety',
      });
      return toDetail(
        unwrap(
          await api.PUT(`${P}/pretask-plans/{planId}/crew/{crewId}/signature`, {
            params: {
              path: crewPath(projectId, d.plan.id, crewId),
              header: ifMatch(d.plan.version),
            },
            body: { signatureFileId: file.id },
          } as never),
        ) as ApiDetail,
      );
    },
    async clearSignature(projectId, d, crewId) {
      return toDetail(
        unwrap(
          await api.DELETE(`${P}/pretask-plans/{planId}/crew/{crewId}/signature`, {
            params: {
              path: crewPath(projectId, d.plan.id, crewId),
              header: ifMatch(d.plan.version),
            },
          } as never),
        ) as ApiDetail,
      );
    },
    async listSwms(projectId) {
      const r = unwrap(
        await api.GET(`${P}/swms`, {
          params: { path: { orgId, projectId }, query: { limit: 100 } },
        } as never),
      ) as { data: { id: string; numberLabel: string; title: string; status: string }[] };
      return r.data.map((s) => ({
        id: s.id,
        label: `${s.numberLabel} ${s.title}`,
        status: s.status,
      }));
    },
    async suggestions(projectId, opts) {
      const r = unwrap(
        await api.GET(`${P}/pretask-plans/suggestions`, {
          params: {
            path: { orgId, projectId },
            query: {
              ...(opts.planId ? { planId: opts.planId } : {}),
              ...(opts.swmsId ? { swmsId: opts.swmsId } : {}),
            },
          },
        } as never),
      ) as { data: Suggestion[] };
      return r.data.map<Suggestion>((s) => ({ ...s }));
    },
  };
}
