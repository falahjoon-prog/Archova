// RFIs against the rfis module's endpoints (backend 04 §3, Ben's PR #10), with the same interface as the preview
// source so the screens and hooks don't change. People and companies come back as ids; names are resolved from the
// project's members. The API has one assignee list, a ball-in-court user list, a drawing pin and an activity feed.

import { ApiError, unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api, ensureCsrfToken } from '@/shared/lib/api';
import { compressPhoto } from '@/shared/lib/compress-photo';
import { allPages } from '@/shared/lib/data-mode';
import { formatLocalDate } from '@/shared/lib/format';
import { projectMembers, type ProjectPerson } from '@/shared/lib/people';
import { fileDownloadUrl, uploadFile } from '@/shared/lib/uploads';
import type {
  CostImpact,
  NovaDraft,
  NovaReference,
  NovaRfiDraft,
  Rfi,
  RfiActivity,
  RfiAnnotation,
  RfiInput,
  RfiPhoto,
  RfiResponse,
} from '../lib/types';
import { MARKABLE_IMAGE_TYPES } from '../lib/types';
import { fromApiShape, toApiShape } from '@/shared/markup/api-shape';
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
    fileIds: r.fileIds,
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
    specSection: r.specSection,
    location: r.location,
    locationId: r.locationId,
    locationPath: r.locationPath,
    fileIds: r.fileIds,
    responses: responses.map((x) => toResponse(x, members)),
    officialResponseId: r.officialResponseId,
    activity: [],
    createdAt: r.createdAt,
    answeredAt: r.answeredAt,
    closedAt: r.closedAt,
    version: r.version,
  };
}

/** The fields the API accepts from the form. */
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

const NOVA_PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const NOVA_PHOTO_MAX_BYTES = 3 * 1024 * 1024;

const unavailable = (detail: string) =>
  new ApiError(422, {
    type: 'about:blank',
    title: detail,
    status: 422,
    detail,
    code: 'validation_failed',
  } as never);

type ApiCitation = components['schemas']['NovaCitation'];

const toReference = (r: ApiCitation, i: number): NovaReference => ({
  id: `${r.revisionId}:${r.page}:${i}`,
  kind: r.sourceType,
  sourceId: r.sourceId,
  revisionId: r.revisionId,
  label: `${r.reference ?? r.title}${r.sourceType === 'drawing' ? ` Rev ${r.revision}` : ''}`,
  quote: r.quote,
});

/** Creating leaves an empty spec section or location out. */
const createRefs = (input: RfiInput) => ({
  ...(input.specSection ? { specSection: input.specSection } : {}),
  ...(input.location ? { location: input.location } : {}),
  ...(input.locationId ? { locationId: input.locationId } : {}),
});

/** Editing sends null to clear one. */
const editRefs = (input: RfiInput) => ({
  specSection: input.specSection || null,
  location: input.location || null,
  // Left out unless the form handled it, so an edit from a screen without the picker keeps the place.
  ...(input.locationId !== undefined ? { locationId: input.locationId } : {}),
});

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

  const decide = async (
    projectId: string,
    suggestionId: string,
    decision: 'accepted' | 'edited' | 'rejected',
  ) => {
    await ensureCsrfToken();
    unwrap(
      await api.POST(
        '/v1/orgs/{orgId}/projects/{projectId}/ai/suggestions/{suggestionId}/decision',
        {
          params: { path: { orgId, projectId, suggestionId } },
          body: { decision },
        },
      ),
    );
  };

  return {
    list,
    get,
    novaDecide: decide,

    async novaDraftRfi(projectId, source): Promise<NovaRfiDraft> {
      // A phone photo is shrunk first (and loses its EXIF); Nova reads PNG, JPEG or WebP up to 3 MB.
      let stored: { id: string } | null = null;
      if (source.photo) {
        const small = await compressPhoto(source.photo);
        const photo =
          small === source.photo
            ? source.photo
            : new File([small], `${source.photo.name.replace(/\.\w+$/, '')}.jpg`, {
                type: small.type,
              });
        if (!NOVA_PHOTO_TYPES.includes(photo.type) || photo.size > NOVA_PHOTO_MAX_BYTES)
          throw unavailable('Add a PNG, JPEG or WebP photo under 3 MB and Nova can draft from it.');
        stored = await uploadFile(orgId, { file: photo, projectId, module: 'rfis' });
      }
      await ensureCsrfToken();
      const note = source.note.trim();
      const d = unwrap(
        await api.POST('/v1/orgs/{orgId}/projects/{projectId}/ai/rfi-drafts', {
          params: { path: { orgId, projectId } },
          body: {
            ...(note ? { note } : {}),
            ...(source.markup
              ? {
                  markup: {
                    drawingRevisionId: source.markup.revisionId,
                    markupId: source.markup.markupId,
                  },
                }
              : {}),
            ...(stored ? { photo: { fileId: stored.id } } : {}),
          },
        }),
      );
      return {
        suggestionId: d.suggestionId,
        subject: d.subject,
        question: d.question,
        discipline: d.discipline,
        references: d.references.map(toReference),
        gaps: d.gaps,
        unsupportedNumbers: d.unsupportedNumbers,
        similar: d.similarRfis.map(({ id, number, subject }) => ({ id, number, subject })),
        drawing: d.drawing
          ? {
              revisionId: d.drawing.drawingRevisionId,
              label: `${d.drawing.sheetNumber} Rev ${d.drawing.rev}`,
              x: d.drawing.pin.x,
              y: d.drawing.pin.y,
              scanned: d.drawing.scanned,
            }
          : null,
      };
    },

    async create(projectId, input, _actor, submit) {
      await ensureCsrfToken();
      const created = await detail(
        projectId,
        unwrap(
          await api.POST(P, {
            params: { path: { orgId, projectId }, header: idempotencyKey() },
            body: {
              ...toRequest(
                input,
                input.drawing
                  ? { drawingRevisionId: input.drawing.revisionId, ...input.drawing.pin }
                  : undefined,
              ),
              ...createRefs(input),
              ...(input.nova ? { aiSuggestionId: input.nova.suggestionId } : {}),
            },
          }),
        ),
      );
      // The draft is decided once the RFI exists: as it was, or edited. A failed record must not lose the RFI.
      if (input.nova) {
        const same =
          input.subject.trim() === input.nova.subject.trim() &&
          input.question.trim() === input.nova.question.trim();
        await decide(projectId, input.nova.suggestionId, same ? 'accepted' : 'edited').catch(
          () => undefined,
        );
      }
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
        unwrap(
          await api.PATCH(`${P}/{rfiId}`, {
            params,
            body: { ...toRequest(input, pin), ...editRefs(input) },
          }),
        ),
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

    async photos(projectId, rfi): Promise<RfiPhoto[]> {
      const origins = new Map<string, RfiPhoto['origin']>();
      for (const id of rfi.fileIds) origins.set(id, 'question');
      for (const r of rfi.responses)
        for (const id of r.fileIds) origins.set(id, origins.get(id) ?? 'response');
      const found = await Promise.all(
        [...origins].map(async ([fileId, origin]): Promise<RfiPhoto | null> => {
          // A file the person can't open (or that is still being checked) is left out rather than failing the list.
          try {
            const file = unwrap(
              await api.GET('/v1/orgs/{orgId}/files/{fileId}', {
                params: { path: { orgId, fileId } },
              }),
            );
            if (file.status !== 'ready') return null;
            if (!(MARKABLE_IMAGE_TYPES as readonly string[]).includes(file.mime)) return null;
            return {
              fileId,
              name: file.filename,
              url: await fileDownloadUrl(orgId, fileId),
              origin,
            };
          } catch {
            return null;
          }
        }),
      );
      return found.filter((x): x is RfiPhoto => x !== null);
    },

    async addPhoto(projectId, rfiId, photo) {
      // A phone photo is shrunk first (and loses its EXIF location); the original is not kept.
      const small = await compressPhoto(photo);
      const file =
        small === photo
          ? photo
          : new File([small], `${photo.name.replace(/\.\w+$/, '')}.jpg`, { type: small.type });
      const stored = await uploadFile(orgId, { file, projectId, module: 'rfis' });
      const params = await current(projectId, rfiId);
      const was = await get(projectId, rfiId);
      return detail(
        projectId,
        unwrap(
          await api.PATCH(`${P}/{rfiId}`, {
            params,
            body: { fileIds: [...was.fileIds, stored.id] },
          }),
        ),
      );
    },

    async annotations(projectId, rfiId): Promise<RfiAnnotation[]> {
      const [rows, people] = await Promise.all([
        api.GET(`${P}/{rfiId}/annotations`, { params: { path: { orgId, projectId, rfiId } } }),
        members(projectId),
      ]);
      return unwrap(rows).data.map((a) => ({
        id: a.id,
        fileId: a.fileId,
        authorId: a.authorId ?? '',
        authorName: people.find((m) => m.id === a.authorId)?.name ?? 'Project member',
        shapes: a.shapes.flatMap((x) => {
          const shape = fromApiShape(x);
          return shape && shape.kind !== 'pin' ? [shape] : [];
        }),
        updatedAt: a.updatedAt,
      }));
    },

    async saveAnnotation(projectId, rfiId, fileId, shapes, actor): Promise<RfiAnnotation | null> {
      await ensureCsrfToken();
      const res = unwrap(
        await api.PUT(`${P}/{rfiId}/files/{fileId}/annotation`, {
          params: { path: { orgId, projectId, rfiId, fileId }, header: idempotencyKey() },
          body: { shapes: shapes.map((x, i) => toApiShape(x, `s${i + 1}`)) },
        }),
      );
      const a = res.annotation;
      return a
        ? {
            id: a.id,
            fileId: a.fileId,
            authorId: actor.id,
            authorName: actor.name,
            shapes: [...shapes],
            updatedAt: a.updatedAt,
          }
        : null;
    },

    async novaDraftResponse(projectId, rfiId, direction): Promise<NovaDraft> {
      await ensureCsrfToken();
      const d = unwrap(
        await api.POST('/v1/orgs/{orgId}/projects/{projectId}/ai/rfis/{rfiId}/answer-drafts', {
          params: { path: { orgId, projectId, rfiId } },
          body: direction?.trim() ? { direction: direction.trim() } : {},
        }),
      );
      return {
        id: d.suggestionId,
        text: d.answer,
        basis: d.basis,
        needsDecision: d.needsDecision,
        references: d.references.map(toReference),
        unsupportedNumbers: d.unsupportedNumbers,
        unreadFiles: d.attachments.filter((a) => !a.read).map((a) => a.name),
      };
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
