import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';
import { uploadFile } from '@/shared/lib/uploads';
import type {
  HandoverAction,
  HandoverExport,
  HandoverFlag,
  HandoverInput,
  HandoverItem,
  HandoverPack,
} from '../lib/types';
import type { HandoverSource } from './source';

type ApiItem = components['schemas']['HandoverItem'];

const P = '/v1/orgs/{orgId}/projects/{projectId}/handover' as const;
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

const toItem = (i: ApiItem): HandoverItem => ({
  id: i.id,
  numberLabel: i.numberLabel,
  category: i.category,
  title: i.title,
  description: i.description,
  required: i.required,
  status: i.status,
  state: i.state,
  responsibleCompanyId: i.responsibleCompanyId,
  dueOn: i.dueOn,
  receivedOn: i.receivedOn,
  approvedOn: i.approvedOn,
  note: i.note,
  fileIds: i.fileIds,
  version: i.version,
});

/** The live source. A project's checklist is tens of items, so it is read whole and filtered on screen. */
export function createHandoverApi(orgId: string): HandoverSource {
  const path = (projectId: string) => ({ orgId, projectId });
  return {
    async pack(projectId) {
      const r = unwrap(await api.GET(P, { params: { path: path(projectId) } }));
      return {
        items: r.items.map(toItem),
        summary: r.summary,
        readyToIssue: r.readyToIssue,
        flags: r.flags as HandoverFlag[],
        issues: r.issues.map((x) => ({
          id: x.id,
          recipientName: x.recipientName,
          note: x.note,
          incompleteCount: x.incompleteCount,
          issuedAt: x.issuedAt,
        })),
      } satisfies HandoverPack;
    },
    async create(projectId, input: HandoverInput) {
      return toItem(
        unwrap(
          await api.POST(`${P}/items`, {
            params: { path: path(projectId), header: idempotencyKey() },
            body: input,
          }),
        ).item,
      );
    },
    async update(projectId, item, input) {
      return toItem(
        unwrap(
          await api.PATCH(`${P}/items/{handoverItemId}`, {
            params: {
              path: { ...path(projectId), handoverItemId: item.id },
              header: ifMatch(item.version),
            },
            body: input,
          }),
        ).item,
      );
    },
    async attach(projectId, item, files) {
      const ids: string[] = [...item.fileIds];
      for (const file of files)
        ids.push((await uploadFile(orgId, { file, projectId, module: 'handover' })).id);
      return toItem(
        unwrap(
          await api.PATCH(`${P}/items/{handoverItemId}`, {
            params: {
              path: { ...path(projectId), handoverItemId: item.id },
              header: ifMatch(item.version),
            },
            body: { fileIds: ids },
          }),
        ).item,
      );
    },
    async transition(projectId, item, t: { action: HandoverAction; note?: string }) {
      return toItem(
        unwrap(
          await api.POST(`${P}/items/{handoverItemId}/transition`, {
            params: {
              path: { ...path(projectId), handoverItemId: item.id },
              header: ifMatch(item.version),
            },
            body: { action: t.action, ...(t.note ? { note: t.note } : {}) },
          }),
        ).item,
      );
    },
    async applyTemplate(projectId) {
      return unwrap(await api.POST(`${P}/template`, { params: { path: path(projectId) } })).added;
    },
    async export(projectId) {
      return unwrap(
        await api.GET(`${P}/export`, { params: { path: path(projectId) } }),
      ) as HandoverExport;
    },
    async issue(projectId, input) {
      const r = unwrap(
        await api.POST(`${P}/issues`, {
          params: { path: path(projectId), header: idempotencyKey() },
          body: input,
        }),
      );
      return {
        id: r.id,
        recipientName: r.recipientName,
        note: r.note,
        incompleteCount: r.incompleteCount,
        issuedAt: r.issuedAt,
      };
    },
  };
}
