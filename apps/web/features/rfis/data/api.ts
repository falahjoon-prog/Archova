// RFIs against the rfis module's endpoints (backend 04 §3, Ben's PR #10), with the same interface as the preview
// source so the screens and hooks don't change. People and companies come back as ids; names are resolved from the
// project's members. The API has one assignee list, a ball-in-court user list, a drawing pin and an activity feed;
// it has no spec section or location yet, and Nova's answer drafts aren't served yet.

import { ApiError, unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api, ensureCsrfToken } from '@/shared/lib/api';
import { allPages } from '@/shared/lib/data-mode';
import { formatLocalDate } from '@/shared/lib/format';
import { projectMembers, type ProjectPerson } from '@/shared/lib/people';
import type { CostImpact, Rfi, RfiActivity, RfiInput, RfiResponse } from '../lib/types';
import { rfisSource, type RfiFilters, type RfisSource } from './source';

type ApiRfi = components['schemas']['Rfi'];
type ApiResponse = components['schemas']['RfiResponse'];
type ApiDetail = components['schemas']['RfiDetail'];
type ApiActivity = components['schemas']['RfiActivityItem'];

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
    aiSuggestionId: r.aiSuggestionId,
    createdAt: r.createdAt,
  };
}

const ACTIONS: Record<ApiActivity['kind'], string> = {
  created: 'created the RFI',
  updated: 'updated the RFI',
  opened: 'submitted the RFI',
  responded: 'responded',
  answered: 'marked the RFI answered',
  closed: 'closed the RFI',
  reopened: 'reopened the RFI',
  voided: 'voided the RFI',
  imported: 'imported the RFI',
};

export function toActivity(a: ApiActivity, members: readonly ProjectPerson[]): RfiActivity {
  const d = a.details;
  const person = (id: string) => members.find((m) => m.id === id)?.name ?? 'a project member';
  const [before, after] = d.dueDate ?? [];
  // A due date change is shown as before and after, so it isn't repeated as text.
  const others = (d.changed ?? []).filter((f) => !(d.dueDate && f === 'dueDate'));
  const changed = others.length ? `Changed: ${others.join(', ')}` : undefined;
  return {
    id: a.id,
    actor: a.actorId ? person(a.actorId) : 'Someone on an access link or the system',
    action: ACTIONS[a.kind] ?? a.kind,
    ...(d.dueDate
      ? {
          before: before ? formatLocalDate(before) : 'No due date',
          after: after ? formatLocalDate(after) : 'No due date',
        }
      : {}),
    ...(d.reason ? { detail: d.reason } : changed ? { detail: changed } : {}),
    at: a.at,
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

/** The fields the API accepts from the form. Spec section and location aren't stored by the API yet. */
function toRequest(input: RfiInput, pin?: unknown) {
  return {
    subject: input.subject,
    question: input.question,
    ...(input.assigneeId ? { assigneeIds: [input.assigneeId] } : {}),
    ...(input.dueDate ? { dueDate: input.dueDate } : {}),
    distributionCompanyIds: input.distributionCompanyIds,
    ...(input.costImpact ? { costImpact: input.costImpact as CostImpact } : {}),
    ...(input.scheduleImpactDays !== null ? { scheduleImpactDays: input.scheduleImpactDays } : {}),
    isPrivate: input.isPrivate,
    ...(pin !== undefined ? { pin: pin as never } : {}),
  };
}

export function createRfisApi(orgId: string): RfisSource {
  const members = (projectId: string) => projectMembers(orgId, projectId);
  const detail = async (projectId: string, d: ApiDetail) => {
    const [people, feed] = await Promise.all([
      members(projectId),
      api.GET(`${P}/{rfiId}/activity`, {
        params: { path: { orgId, projectId, rfiId: d.rfi.id } },
      }),
    ]);
    return {
      ...toRfi(d.rfi, d.responses, people),
      activity: unwrap(feed).data.map((x) => toActivity(x, people)),
    };
  };

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
            body: toRequest(
              input,
              input.drawing ? { drawingRevisionId: input.drawing.revisionId } : undefined,
            ),
          }),
        ),
      );
      return submit ? open(projectId, created.id) : created;
    },

    async update(projectId, id, input) {
      const params = await current(projectId, id);
      // Leave the pin alone unless the sheet changed, so a spot marked in the viewer isn't lost on an edit.
      const was = (await get(projectId, id)).drawing?.revisionId ?? null;
      const now = input.drawing?.revisionId ?? null;
      const pin = was === now ? undefined : now ? { drawingRevisionId: now } : null;
      return detail(
        projectId,
        unwrap(await api.PATCH(`${P}/{rfiId}`, { params, body: toRequest(input, pin) })),
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
            body: {
              body: input.body.trim(),
              ...(input.aiSuggestionId ? { aiSuggestionId: input.aiSuggestionId } : {}),
            },
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
