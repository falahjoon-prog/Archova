// Event types a webhook may subscribe to (integrations/06 §5: only events marked public are offered). Deliveries are
// notifications: the envelope's ids and version, never its `data`, so a consumer re-fetches through the API and the
// token or user it holds decides what it may see.
export const PUBLIC_EVENT_TYPES: readonly string[] = [
  'platform.project.created.v1',
  'platform.project.updated.v1',
  'platform.company.created.v1',
  'platform.project_member.added.v1',
  'platform.project_member.removed.v1',
  'documents.document.created.v1',
  'documents.document.updated.v1',
  'documents.transmittal.sent.v1',
  'rfis.rfi.created.v1',
  'rfis.rfi.opened.v1',
  'rfis.rfi.updated.v1',
  'rfis.rfi.closed.v1',
  'rfis.rfi.reopened.v1',
  'rfis.rfi.voided.v1',
  'submittals.submittal.created.v1',
  'submittals.submittal.updated.v1',
  'submittals.submittal.submitted.v1',
  'submittals.submittal.closed.v1',
  'diary.entry.submitted.v1',
  'defects.defect.created.v1',
  'defects.defect.updated.v1',
];

/** The type sent to prove an endpoint is ours to call; never offered as a subscription. */
export const TEST_EVENT_TYPE = 'webhook.test.v1';

export const isPublicEventType = (type: string) => PUBLIC_EVENT_TYPES.includes(type);

export interface WebhookPayload {
  id: string;
  type: string;
  orgId: string;
  projectId: string | null;
  entityType: string;
  entityId: string;
  entityVersion: number | null;
  occurredAt: string;
}
