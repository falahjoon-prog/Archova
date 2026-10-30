import { encodeId } from '@archova/domain';
import type { ImportJob, ImportRow, Webhook, WebhookDelivery } from '@archova/contracts';
import type { ImportJobRow, ImportRowRow } from '../application/imports';
import type { DeliveryRow, SubscriptionRow } from '../application/webhooks';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export const toImportJobDto = (j: ImportJobRow): ImportJob => ({
  id: encodeId('importJob', j.id),
  projectId: encodeId('project', j.projectId),
  entity: j.entity,
  source: j.source,
  fileId: encodeId('file', j.fileId),
  status: j.status,
  headerRow: j.headerRow,
  headers: j.headers,
  mapping: j.mapping,
  totalRows: j.totalRows,
  validRows: j.validRows,
  invalidRows: j.invalidRows,
  startedBy: encodeId('user', j.startedBy),
  createdAt: j.createdAt.toISOString(),
  updatedAt: j.updatedAt.toISOString(),
  finishedAt: iso(j.finishedAt),
  version: j.version,
});

export const toImportRowDto = (r: ImportRowRow): ImportRow => ({
  id: encodeId('importRow', r.id),
  rowNumber: r.rowNumber,
  raw: r.raw,
  normalised: r.normalised,
  sourceRef: r.sourceRef,
  status: r.status,
  errors: r.errors,
  createdEntityId: null,
});

export const toWebhookDto = (w: SubscriptionRow): Webhook => ({
  id: encodeId('webhook', w.id),
  url: w.url,
  description: w.description,
  eventTypes: w.eventTypes,
  projectIds: w.projectIds ? w.projectIds.map((p) => encodeId('project', p)) : null,
  status: w.status,
  disabledReason: w.disabledReason,
  createdAt: w.createdAt.toISOString(),
});

export const toWebhookDeliveryDto = (d: DeliveryRow): WebhookDelivery => ({
  id: encodeId('webhookDelivery', d.id),
  eventId: d.eventId,
  eventType: d.eventType,
  status: d.status,
  attempts: d.attempts,
  lastStatus: d.lastStatus,
  lastError: d.lastError,
  createdAt: d.createdAt.toISOString(),
  deliveredAt: iso(d.deliveredAt),
});
