// Defects against the defects module's endpoints (backend 04 §3, Ben's PR #51) and Nova's defect tags (Ari, PR #63),
// with the same interface as the preview source so the screens and hooks don't change. The API differs from the
// preview store in four ways the screens handle:
//   - a defect sits on a drawing pin, a location from the project's tree, or both; there is no level;
//   - every status change is one `transition` call, and `availableActions` says which buttons to show;
//   - photos are uploaded files attached to a transition (the "before" photos go with `issue`);
//   - people and companies come back as ids, named from the project's members.

import { ApiError, unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api, ensureCsrfToken } from '@/shared/lib/api';
import { allPages } from '@/shared/lib/data-mode';
import { projectMembers, type ProjectPerson } from '@/shared/lib/people';
import { uploadFile } from '@/shared/lib/uploads';
import type {
  Defect,
  DefectEvent,
  DefectNovaSuggestion,
  DefectPhoto,
  DefectStage,
} from '../lib/types';
import type { DefectFilters, DefectsSource } from './source';

type ApiDefect = components['schemas']['Defect'];
type ApiEvent = components['schemas']['DefectEvent'];
type ApiDetail = components['schemas']['DefectDetail'];
type Transition = components['schemas']['DefectTransitionRequest'];
type Pin = components['schemas']['DrawingPin'];

const P = '/v1/orgs/{orgId}/projects/{projectId}/defects' as const;
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

/** Photos Nova can read: it takes PNG, JPEG and WebP up to 3 MB. */
const NOVA_PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const NOVA_PHOTO_MAX_BYTES = 3 * 1024 * 1024;

/** Two pins closer than this fraction of the sheet's width or height are probably the same spot. */
const NEAR_PIN = 0.08;

const personName = (members: readonly ProjectPerson[], id: string | null) =>
  members.find((m) => m.id === id)?.name ?? 'Project member';

export function toDefect(
  d: ApiDefect,
  events: readonly ApiEvent[],
  members: readonly ProjectPerson[],
  fileNames: ReadonlyMap<string, string> = new Map(),
): Defect {
  const photos: DefectPhoto[] = [];
  const mapped: DefectEvent[] = events.map((e) => {
    const kind: DefectPhoto['kind'] =
      e.action === 'create' || e.action === 'issue'
        ? 'before'
        : e.action === 'markReadyForReview'
          ? 'after'
          : 'closeout';
    for (const id of e.fileIds) {
      photos.push({ id, name: fileNames.get(id) ?? 'Photo', kind });
    }
    return {
      id: e.id,
      fromStatus: e.fromStatus as DefectEvent['fromStatus'],
      toStatus: e.toStatus,
      note: e.note,
      photoIds: e.fileIds,
      by: personName(members, e.actorId),
      at: e.at,
    };
  });
  return {
    id: d.id,
    number: d.number,
    title: d.title,
    description: d.description,
    status: d.status,
    priority: d.priority,
    trade: d.trade ?? '',
    category: d.category,
    stage: d.stage,
    locationId: d.locationId,
    locationPath: d.locationPath,
    // The sheet and its label are looked up from the register on screen; the API stores the revision only.
    drawing: d.pin
      ? {
          sheetId: '',
          revisionId: d.pin.drawingRevisionId,
          label: 'Drawing',
          x: d.pin.x,
          y: d.pin.y,
        }
      : null,
    assigneeCompanyId: d.assigneeCompanyId,
    assigneeUserId: d.assigneeUserId,
    dueDate: d.dueDate,
    raisedBy: personName(members, d.createdBy),
    raisedByCompanyId: d.raisedByCompanyId,
    source: d.source,
    photos,
    events: mapped,
    createdAt: d.createdAt,
    readyForReviewAt: d.readyForReviewAt,
    closedAt: d.closedAt,
    availableActions: d.availableActions,
    isOverdue: d.isOverdue,
    version: d.version,
  };
}

const toPin = (drawing: NonNullable<Defect['drawing']>): Pin => ({
  drawingRevisionId: drawing.revisionId,
  x: drawing.x,
  y: drawing.y,
});

const unavailable = (detail: string) =>
  new ApiError(422, {
    type: 'about:blank',
    title: detail,
    status: 422,
    detail,
    code: 'validation_failed',
  } as never);

export function createDefectsApi(orgId: string): DefectsSource {
  const members = (projectId: string) => projectMembers(orgId, projectId);

  /** Names for the files on a defect's history, so the photo list reads as file names. */
  const fileNames = async (ids: readonly string[]) => {
    const names = new Map<string, string>();
    await Promise.all(
      [...new Set(ids)].map(async (fileId) => {
        try {
          const f = unwrap(
            await api.GET('/v1/orgs/{orgId}/files/{fileId}', {
              params: { path: { orgId, fileId } },
            }),
          );
          names.set(fileId, f.filename);
        } catch {
          // The name is a nicety; a file the caller can't read still shows as "Photo".
        }
      }),
    );
    return names;
  };

  const detail = async (projectId: string, d: ApiDetail) =>
    toDefect(
      d.defect,
      d.events,
      await members(projectId),
      await fileNames(d.events.flatMap((e) => e.fileIds)),
    );

  const fetchDetail = async (projectId: string, defectId: string) =>
    unwrap(await api.GET(`${P}/{defectId}`, { params: { path: { orgId, projectId, defectId } } }));

  const get = async (projectId: string, defectId: string) =>
    detail(projectId, await fetchDetail(projectId, defectId));

  const list = async (projectId: string, f: DefectFilters = {}) => {
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
                ...(f.stage ? { stage: f.stage } : {}),
                ...(f.companyId ? { assigneeCompanyId: f.companyId } : {}),
                ...(f.trade ? { trade: f.trade } : {}),
                ...(f.overdueOn ? { overdue: 'true' as const } : {}),
                ...(f.q?.trim() ? { q: f.q.trim() } : {}),
              },
            },
          }),
        ),
      ),
      members(projectId),
    ]);
    return rows.map((d) => toDefect(d, [], people));
  };

  /** Lifecycle calls carry the version the caller last saw, so a stale screen gets 412 rather than a silent overwrite. */
  const transition = async (projectId: string, defectId: string, body: Transition) => {
    await ensureCsrfToken();
    const { defect } = await fetchDetail(projectId, defectId);
    return detail(
      projectId,
      unwrap(
        await api.POST(`${P}/{defectId}/transition`, {
          params: {
            path: { orgId, projectId, defectId },
            header: ifMatch(defect.version),
          },
          body,
        }),
      ),
    );
  };

  const patch = async (
    projectId: string,
    defectId: string,
    body: components['schemas']['UpdateDefectRequest'],
  ) => {
    await ensureCsrfToken();
    const { defect } = await fetchDetail(projectId, defectId);
    return detail(
      projectId,
      unwrap(
        await api.PATCH(`${P}/{defectId}`, {
          params: { path: { orgId, projectId, defectId }, header: ifMatch(defect.version) },
          body,
        }),
      ),
    );
  };

  const upload = (projectId: string, files: readonly File[]) =>
    Promise.all(
      files.map(
        async (file) => (await uploadFile(orgId, { file, projectId, module: 'defects' })).id,
      ),
    );

  const noteOnly = (note: string) => (note.trim() ? { reason: note.trim() } : {});

  return {
    live: true,
    list,
    get,

    /** Drafts the defect on its pin, then issues it to the company with the photos, so it is numbered and sent. */
    async create(projectId, input, _actor, aiSuggestionId) {
      if (!input.drawing && !input.locationId)
        throw unavailable('Choose a location or mark where the defect is on a drawing.');
      const fileIds = await upload(projectId, input.photos);
      await ensureCsrfToken();
      const created = unwrap(
        await api.POST(P, {
          params: { path: { orgId, projectId }, header: idempotencyKey() },
          body: {
            title: input.title.trim(),
            ...(input.description.trim() ? { description: input.description.trim() } : {}),
            priority: input.priority,
            stage: input.stage,
            ...(input.locationId ? { locationId: input.locationId } : {}),
            ...(input.drawing ? { pin: toPin(input.drawing) } : {}),
            ...(input.trade ? { trade: input.trade } : {}),
            ...(input.category ? { category: input.category } : {}),
            ...(input.assigneeCompanyId ? { assigneeCompanyId: input.assigneeCompanyId } : {}),
            ...(input.assigneeUserId ? { assigneeUserId: input.assigneeUserId } : {}),
            ...(input.dueDate ? { dueDate: input.dueDate } : {}),
            ...(aiSuggestionId ? { aiSuggestionId } : {}),
          },
        }),
      );
      if (!input.assigneeCompanyId) return detail(projectId, created);
      return transition(projectId, created.defect.id, {
        action: 'issue',
        assigneeCompanyId: input.assigneeCompanyId,
        ...(fileIds.length ? { fileIds } : {}),
      });
    },

    issue(projectId, id) {
      return transition(projectId, id, { action: 'issue' });
    },

    async markReady(projectId, id, v) {
      const fileIds = await upload(projectId, v.photos);
      return transition(projectId, id, {
        action: 'markReadyForReview',
        ...noteOnly(v.note),
        ...(fileIds.length ? { fileIds } : {}),
      });
    },

    async close(projectId, id, v) {
      const fileIds = await upload(projectId, v.photos);
      return transition(projectId, id, {
        action: 'close',
        ...noteOnly(v.note),
        ...(fileIds.length ? { fileIds } : {}),
      });
    },

    withReason(projectId, id, action, reason) {
      return transition(projectId, id, { action, reason: reason.trim() });
    },

    /** A disputed defect is reassigned with the lifecycle action; the person and due date are ordinary edits. */
    async reassign(projectId, id, v) {
      const reassigned = await transition(projectId, id, {
        action: 'reassign',
        assigneeCompanyId: v.companyId,
      });
      if (!v.userId && !v.dueDate) return reassigned;
      return patch(projectId, id, {
        ...(v.userId ? { assigneeUserId: v.userId } : {}),
        ...(v.dueDate ? { dueDate: v.dueDate } : {}),
      });
    },

    /** One defect at a time: a disputed one is reassigned, an open one has its company edited. */
    async bulkAssign(projectId, ids, p) {
      const out: Defect[] = [];
      for (const id of ids) {
        let d = await get(projectId, id);
        if (p.companyId && p.companyId !== d.assigneeCompanyId) {
          d =
            d.status === 'disputed'
              ? await transition(projectId, id, {
                  action: 'reassign',
                  assigneeCompanyId: p.companyId,
                })
              : await patch(projectId, id, {
                  assigneeCompanyId: p.companyId,
                  assigneeUserId: null,
                });
        }
        if (p.dueDate || p.stage) {
          d = await patch(projectId, id, {
            ...(p.dueDate ? { dueDate: p.dueDate } : {}),
            ...(p.stage ? { stage: p.stage as DefectStage } : {}),
          });
        }
        out.push(d);
      }
      return out;
    },

    /** Nova reads the first photo (PNG, JPEG or WebP, up to 3 MB) with the note and the pin. Nothing is raised. */
    async novaSuggest(projectId, v): Promise<DefectNovaSuggestion | null> {
      const photo = v.photos.find(
        (f) => NOVA_PHOTO_TYPES.includes(f.type) && f.size <= NOVA_PHOTO_MAX_BYTES,
      );
      if (!photo)
        throw unavailable('Add a PNG, JPEG or WebP photo under 3 MB and Nova can suggest details.');
      const stored = await uploadFile(orgId, { file: photo, projectId, module: 'defects' });
      await ensureCsrfToken();
      const tag = unwrap(
        await api.POST('/v1/orgs/{orgId}/projects/{projectId}/ai/defect-tags', {
          params: { path: { orgId, projectId } },
          body: {
            photo: { fileId: stored.id },
            ...(v.description.trim() ? { note: v.description.trim().slice(0, 1000) } : {}),
            ...(v.drawing ? { pin: toPin(v.drawing) } : {}),
          },
        }),
      );
      return {
        id: tag.suggestionId,
        title: tag.title,
        description: tag.description,
        trade: tag.trade,
        category: tag.category,
        priority: tag.priority,
        companyId: null,
        gaps: tag.gaps,
        unsupportedNumbers: tag.unsupportedNumbers,
      };
    },

    async novaDecide(projectId, suggestionId, decision) {
      await ensureCsrfToken();
      unwrap(
        await api.POST(
          '/v1/orgs/{orgId}/projects/{projectId}/ai/suggestions/{suggestionId}/decision',
          { params: { path: { orgId, projectId, suggestionId } }, body: { decision } },
        ),
      );
    },

    /** Open defects pinned beside this spot on the same revision, nearest first. No Nova credit is spent. */
    async novaDuplicates(projectId, v) {
      if (!v.drawing) return [];
      const { revisionId, x, y } = v.drawing;
      const rows = await allPages(async (cursor) =>
        unwrap(
          await api.GET(P, {
            params: {
              path: { orgId, projectId },
              query: { limit: 200, cursor, drawingRevisionId: revisionId },
            },
          }),
        ),
      );
      const people = await members(projectId);
      const distance = (d: ApiDefect) =>
        d.pin ? Math.hypot(d.pin.x - x, d.pin.y - y) : Number.POSITIVE_INFINITY;
      return rows
        .filter((d) => d.status !== 'closed' && d.status !== 'void' && distance(d) <= NEAR_PIN)
        .sort((a, b) => distance(a) - distance(b))
        .map((d) => toDefect(d, [], people));
    },
  };
}
