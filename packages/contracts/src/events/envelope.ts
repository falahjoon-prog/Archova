// Domain event envelope (backend-modules.md §4, conventions §Events).
// Type names: `<module>.<entity>.<past-tense-verb>.v<n>`. Payloads carry ids plus what subscribers need; no PII beyond that.
export interface EventEnvelope<TType extends string = string, TData = unknown> {
  id: string;
  type: TType;
  orgId: string;
  projectId: string | null;
  entityType: string;
  entityId: string;
  entityVersion: number | null;
  actor: { type: 'user' | 'api_client' | 'system' | 'support'; id: string | null };
  data: TData;
  traceId: string | null;
  occurredAt: string;
}

export interface FoundationEvents {
  'platform.org.created.v1': { orgId: string; ownerUserId: string };
  'platform.project.created.v1': { projectId: string; name: string };
  'platform.project.updated.v1': { projectId: string; changed: string[] };
  'platform.project.key_dates_changed.v1': { projectId: string; changed: string[] };
  'platform.project.location_changed.v1': {
    projectId: string;
    locationId: string;
    change: 'added' | 'updated' | 'removed';
  };
  'platform.project_member.added.v1': {
    projectId: string;
    userId: string;
    companyId: string;
    permissionTemplateId: string;
    isExternal: boolean;
  };
  'platform.project_member.removed.v1': {
    projectId: string;
    userId: string;
    kind: 'ordinary' | 'for_cause' | 'wipe_now';
  };
  'platform.company.created.v1': { companyId: string };
  'files.object.ready.v1': {
    fileId: string;
    projectId: string | null;
    module: string;
    mime: string;
  };
  'identity.session.revoked.v1': { sessionId: string; userId: string };
}

export type FoundationEventType = keyof FoundationEvents;
