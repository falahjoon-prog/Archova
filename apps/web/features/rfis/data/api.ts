// RFIs against the rfis module's endpoints (backend 04 §3, Ben's PR #10), with the same interface as the preview
// source so the screens and hooks don't change. People and companies come back as ids; names are resolved from the
// project's members. The API has one assignee list, a ball-in-court user list and a drawing pin; it has no spec
// section, location or activity feed yet, and Nova's RFI drafts aren't served yet.

import { ApiError, unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api, ensureCsrfToken } from '@/shared/lib/api';
import { allPages } from '@/shared/lib/data-mode';
import { projectMembers, type ProjectPerson } from '@/shared/lib/people';
import type { CostImpact, Rfi, RfiInput, RfiResponse } from '../lib/types';
import { rfisSource, type RfiFilters, type RfisSource } from './source';

type ApiRfi = components['schemas']['Rfi'];
type ApiResponse = components['schemas']['RfiResponse'];
type ApiDetail = components['schemas']['RfiDetail'];

const P = '/v1/orgs/{orgId}/projects/{projectId}/rfis' as const;
const ifMatch = (version: number | undefined) => ({ 'If-Match': `"${version ?? 0}"` });
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

function toResponse(r: ApiResponse, members: readonly ProjectPerson[]): RfiResponse {
  const author = members.find((m) => m.id === r.authorId);
  return {
    id: r.id,
    authorId: r.authorId ?? '',
    authorName: author?.name ?? 'Project member',
    authorCompanyId: author?.companyId ?? null,
    body: r.body,
    isOfficial: r.isOfficial,
    aiSuggestionId: null,
    createdAt: r.createdAt,
  };
}

export function toRfi(
  r: ApiRfi,
  responses: readonly ApiResponse[],
  members: readonly ProjectPerson[],
): Rfi {
  const companyOf = (id: string | null) => members.find((m) => m.id === id)?.companyId ?? null;
  const assignee = r.assignees[0] ?? null;
  const ballInCourtId = r.ballInCourt.userIds[0] ?? null;
  return {
    id: r.id,
    number: r.number,
    subject: r.subject,
    question: r.question,
    status: r.status,
    isPrivate: r.isPrivate,
    managerId: r.managerId ?? r.createdBy ?? '',
    assigneeId: assignee?.userId ?? null,
    assigneeCompanyId: assignee?.companyId ?? companyOf(assignee?.userId ?? null),
    ballInCourtId,
    ballInCourtCompanyId:
      r.assignees.find((a) => a.userId === ballInCourtId)?.companyId ?? companyOf(ballInCourtId),
    distributionCompanyIds: r.distributionCompanyIds,
    dueDate: r.dueDate,
    costImpact: r.costImpact,
    scheduleImpactDays: r.scheduleImpactDays,
    // The sheet and label are looked up from the register on screen; the API stores the revision only.
    drawing: r.pin ? { sheetId: '', revisionId: r.pin.drawingRevisionId, label: 'Drawing' } : null,
    specSection: null,
    location: null,
    responses: responses.map((x) => toResponse(x, members)),
    officialResponseId: r.officialResponseId,
    activity: [],
    createdAt: r.createdAt,
    answeredAt: r.answeredAt,
    closedAt: r.closedAt,
    version: r.version,
  };
}

/** The fields the API accepts from the form. Spec section, location and drawing aren't stored by the API yet. */
function toRequest(input: RfiInput) {
  return {
    subject: input.subject,
    question: input.question,
    ...(input.assigneeId ? { assigneeIds: [input.assigneeId] } : {}),
    ...(input.dueDate ? { dueDate: input.dueDate } : {}),
    distributionCompanyIds: input.distributionCompanyIds,
    ...(input.costImpact ? { costImpact: input.costImpact as CostImpact } : {}),
    ...(input.scheduleImpactDays !== null ? { scheduleImpactDays: input.scheduleImpactDays } : {}),
    isPrivate: input.isPrivate,
  };
}

export function createRfisApi(orgId: string): RfisSource {
  const members = (projectId: string) => projectMembers(orgId, projectId);
  const detail = async (projectId: string, d: ApiDetail) =>
    toRfi(d.rfi, d.responses, await members(projectId));

  const get = async (projectId: string, rfiId: string) =>
    detail(
      projectId,
      unwrap(await api.GET(`${P}/{rfiId}`, { params: { path: { orgId, projectId, rfiId } } })),
    );

  const list = async (projectId: string, f: RfiFilters = {}) => {
    const [rows, people] = await Promise.all([
      allPages(async (cursor) =>
        unwrap(
          await api.GET(P, {
            params: {
              path: { orgId, projectId },
              query: {
                limit: 200,
                cursor,
                ...(f.status ? { status: f.status } : {}),
                ...(f.impact ? { costImpact: 'yes' as const } : {}),
                ...(f.overdueBefore ? { overdue: 'true' as const } : {}),
                ...(f.q?.trim() ? { q: f.q.trim() } : {}),
              },
            },
          }),
        ),
      ),
      members(projectId),
    ]);
    const rfis = rows.map((r) => toRfi(r, [], people));
    // The API filters ball-in-court by person; the register filters by company.
    return f.ballInCourtCompanyId
      ? rfis.filter((r) => r.ballInCourtCompanyId === f.ballInCourtCompanyId)
      : rfis;
  };

  /** Lifecycle calls carry the version the caller last saw, so a stale screen gets 412 rather than a silent overwrite. */
  const current = async (projectId: string, rfiId: string) => {
    await ensureCsrfToken();
    const rfi = await get(projectId, rfiId);
    return { path: { orgId, projectId, rfiId }, header: ifMatch(rfi.version) };
  };

  const open = async (projectId: string, rfiId: string) =>
    detail(
      projectId,
      unwrap(await api.POST(`${P}/{rfiId}/open`, { params: await current(projectId, rfiId) })),
    );

  return {
    list,
    get,

    async create(projectId, input, _actor, submit) {
      await ensureCsrfToken();
      const created = await detail(
        projectId,
        unwrap(
          await api.POST(P, {
            params: { path: { orgId, projectId }, header: idempotencyKey() },
            body: toRequest(input),
          }),
        ),
      );
      return submit ? open(projectId, created.id) : created;
    },

    async update(projectId, id, input) {
      const params = await current(projectId, id);
      return detail(
        projectId,
        unwrap(await api.PATCH(`${P}/{rfiId}`, { params, body: toRequest(input) })),
      );
    },

    submit: (projectId, id) => open(projectId, id),

    async respond(projectId, id, input) {
      await ensureCsrfToken();
      return detail(
        projectId,
        unwrap(
          await api.POST(`${P}/{rfiId}/responses`, {
            params: { path: { orgId, projectId, rfiId: id }, header: idempotencyKey() },
            body: { body: input.body.trim() },
          }),
        ),
      );
    },

    async close(projectId, id, officialResponseId) {
      const params = await current(projectId, id);
      return detail(
        projectId,
        unwrap(await api.POST(`${P}/{rfiId}/close`, { params, body: { officialResponseId } })),
      );
    },

    async reopen(projectId, id, reason) {
      const params = await current(projectId, id);
      return detail(
        projectId,
        unwrap(await api.POST(`${P}/{rfiId}/reopen`, { params, body: { reason: reason.trim() } })),
      );
    },

    async void(projectId, id, reason) {
      const params = await current(projectId, id);
      return detail(
        projectId,
        unwrap(await api.POST(`${P}/{rfiId}/void`, { params, body: { reason: reason.trim() } })),
      );
    },

    async novaDraftResponse() {
      throw new ApiError(501, {
        type: 'about:blank',
        title: 'Not available yet',
        status: 501,
        detail: "Nova can't draft RFI answers on this project yet.",
        code: 'ai.not_available',
      } as never);
    },

    // Rewording runs on the text alone, so the preview's version serves until Nova's endpoint lands.
    novaImproveQuestion: rfisSource.novaImproveQuestion,

    async novaSimilar(projectId, subject) {
      const words = subject
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 3);
      if (!words.length) return [];
      // One search per word, so any shared word finds a match, as the preview does.
      const pages = await Promise.all(words.slice(0, 3).map((q) => list(projectId, { q })));
      const seen = new Set<string>();
      return pages
        .flat()
        .filter((r) => r.number !== null && !seen.has(r.id) && seen.add(r.id))
        .map(({ id, number, subject: s, status }) => ({ id, number, subject: s, status }));
    },
  };
}
