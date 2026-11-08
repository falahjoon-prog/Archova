import { encodeId } from '@archova/domain';
import type { Permit, PermitDetail, PermitFlag, PermitRequirement } from '@archova/contracts';
import { permitLabel, type PermitFlag as Flag } from '../domain/permit';
import type { PermitService, PermitView } from '../application/permits';

export const toPermitDto = (r: PermitView): Permit => ({
  id: encodeId('permit', r.id),
  projectId: encodeId('project', r.projectId),
  number: r.number,
  numberLabel: permitLabel(r.number),
  kind: r.kind,
  title: r.title,
  issuingAuthority: r.issuingAuthority,
  referenceNumber: r.referenceNumber,
  holderCompanyId: r.holderCompanyId ? encodeId('company', r.holderCompanyId) : null,
  issuedOn: r.issuedOn,
  expiresOn: r.expiresOn,
  lifecycle: r.lifecycle,
  status: r.status,
  daysToExpiry: r.daysToExpiry,
  renewalStartedOn: r.renewalStartedOn,
  notes: r.notes,
  fileIds: r.fileIds.map((f) => encodeId('file', f)),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  version: r.version,
});

export const toPermitDetail = (d: Awaited<ReturnType<PermitService['detail']>>): PermitDetail => ({
  permit: toPermitDto(d.permit),
  events: d.events.map((e) => ({
    id: encodeId('permitEvent', e.id),
    action: e.action,
    fromLifecycle: e.fromLifecycle as PermitDetail['events'][number]['fromLifecycle'],
    toLifecycle: e.toLifecycle as PermitDetail['events'][number]['toLifecycle'],
    expiresOn: e.expiresOn,
    note: e.note,
    actorId: e.actorId ? encodeId('user', e.actorId) : null,
    at: e.at.toISOString(),
  })),
});

export const toRequirementDto = (r: {
  kind: PermitRequirement['kind'];
  leadDays: number;
}): PermitRequirement => ({
  kind: r.kind,
  leadDays: r.leadDays,
});

export const toFlagDto = (f: Flag): PermitFlag => ({
  kind: f.kind,
  severity: f.severity,
  title: f.title,
  detail: f.detail,
  permitId: f.permitId ? encodeId('permit', f.permitId) : null,
  permitKind: f.permitKind,
  expiresOn: f.expiresOn,
  daysLeft: f.daysLeft,
});
