import { encodeId } from '@archova/domain';
import type {
  CompanyCoverClearance,
  Cover,
  CoverDetail,
  CoverFlag,
  CoverRequirement,
} from '@archova/contracts';
import {
  coverCategory,
  coverLabel,
  type CompanyIssue,
  type CoverFlag as Flag,
  type GateState,
} from '../domain/cover';
import type { CoverService, CoverView } from '../application/covers';

export const toCoverDto = (r: CoverView): Cover => ({
  id: encodeId('cover', r.id),
  projectId: encodeId('project', r.projectId),
  number: r.number,
  numberLabel: coverLabel(r.number),
  kind: r.kind,
  title: r.title,
  issuer: r.issuer,
  amountCents: r.amountCents,
  category: coverCategory(r.kind),
  referenceNumber: r.referenceNumber,
  companyId: encodeId('company', r.companyId),
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

export const toCoverDetail = (d: Awaited<ReturnType<CoverService['detail']>>): CoverDetail => ({
  cover: toCoverDto(d.cover),
  events: d.events.map((e) => ({
    id: encodeId('coverEvent', e.id),
    action: e.action,
    fromLifecycle: e.fromLifecycle as CoverDetail['events'][number]['fromLifecycle'],
    toLifecycle: e.toLifecycle as CoverDetail['events'][number]['toLifecycle'],
    expiresOn: e.expiresOn,
    note: e.note,
    actorId: e.actorId ? encodeId('user', e.actorId) : null,
    at: e.at.toISOString(),
  })),
});

export const toRequirementDto = (r: {
  kind: CoverRequirement['kind'];
  leadDays: number;
  minAmountCents: number | null;
}): CoverRequirement => ({
  kind: r.kind,
  leadDays: r.leadDays,
  minAmountCents: r.minAmountCents,
});

export const toFlagDto = (f: Flag): CoverFlag => ({
  kind: f.kind,
  severity: f.severity,
  title: f.title,
  detail: f.detail,
  companyId: encodeId('company', f.companyId),
  coverId: f.coverId ? encodeId('cover', f.coverId) : null,
  coverKind: f.coverKind,
  expiresOn: f.expiresOn,
  daysLeft: f.daysLeft,
});

export const toClearanceDto = (
  companyId: string,
  c: { state: GateState; requirementsSet: boolean; coverCount: number; issues: CompanyIssue[] },
): CompanyCoverClearance => ({
  companyId: encodeId('company', companyId),
  state: c.state,
  requirementsSet: c.requirementsSet,
  coverCount: c.coverCount,
  issues: c.issues.map((i) => ({
    kind: i.kind,
    level: i.level,
    coverId: i.coverId ? encodeId('cover', i.coverId) : null,
    coverKind: i.coverKind,
    expiresOn: i.expiresOn,
    daysLeft: i.daysLeft,
    message: i.message,
  })),
});
