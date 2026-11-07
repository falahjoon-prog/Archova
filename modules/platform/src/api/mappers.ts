import { encodeId } from '@archova/domain';
import type {
  Company,
  KeyDateChange,
  KeyDates,
  MembershipSummary,
  Org,
  Project,
  ProjectMember,
} from '@archova/contracts';
import type { KeyDateChangeRow, KeyDatesView } from '../application/key-dates';
import type { companies, orgs, projectMembers, projects } from '../infra/tables';

const iso = (d: Date) => d.toISOString();

export const toOrgDto = (o: typeof orgs.$inferSelect): Org => ({
  id: encodeId('org', o.id),
  name: o.name,
  legalName: o.legalName,
  abn: o.abn,
  slug: o.slug,
  country: o.country,
  timezone: o.timezone,
  kind: o.kind,
  createdAt: iso(o.createdAt),
  updatedAt: iso(o.updatedAt),
  version: o.version,
});

export const toProjectDto = (p: typeof projects.$inferSelect): Project => ({
  id: encodeId('project', p.id),
  orgId: encodeId('org', p.orgId),
  name: p.name,
  number: p.number,
  status: p.status,
  phase: p.phase,
  state: p.state,
  timezone: p.timezone,
  address: p.address,
  siteLocation:
    p.siteLat !== null && p.siteLng !== null ? { lat: p.siteLat, lng: p.siteLng } : null,
  geofenceRadiusM: p.geofenceRadiusM,
  startDate: p.startDate,
  endDate: p.endDate,
  createdAt: iso(p.createdAt),
  updatedAt: iso(p.updatedAt),
  version: p.version,
});

export const toCompanyDto = (c: typeof companies.$inferSelect): Company => ({
  id: encodeId('company', c.id),
  name: c.name,
  abn: c.abn,
  type: c.type,
  trades: c.trades,
  email: c.email,
  phone: c.phone,
  isOwnCompany: c.isOwnCompany,
  createdAt: iso(c.createdAt),
  updatedAt: iso(c.updatedAt),
  version: c.version,
});

export const toProjectMemberDto = (
  m: typeof projectMembers.$inferSelect & { name: string; email: string },
): ProjectMember => ({
  id: encodeId('projectMember', m.id),
  projectId: encodeId('project', m.projectId),
  userId: encodeId('user', m.userId),
  name: m.name,
  email: m.email,
  companyId: encodeId('company', m.companyId),
  permissionTemplateId: encodeId('permissionTemplate', m.permissionTemplateId),
  isExternal: m.isExternal,
  status: m.status,
});

export const toMembershipSummary = (o: {
  id: string;
  name: string;
  slug: string;
  role: MembershipSummary['role'];
}): MembershipSummary => ({
  orgId: encodeId('org', o.id),
  orgName: o.name,
  orgSlug: o.slug,
  role: o.role,
  kind: o.role ? 'member' : 'external',
});

export const toKeyDatesDto = (k: KeyDatesView): KeyDates => ({
  ...k,
  projectId: encodeId('project', k.projectId),
});

export const toKeyDateChangeDto = (
  c: KeyDateChangeRow,
  names: ReadonlyMap<string, string>,
): KeyDateChange => ({
  id: c.id,
  field: c.field as KeyDateChange['field'],
  sectionId: c.sectionId,
  sectionName: c.sectionName,
  from: c.oldValue,
  to: c.newValue,
  reason: c.reason,
  note: c.note,
  changedBy:
    c.changedBy && names.has(c.changedBy)
      ? { id: encodeId('user', c.changedBy), name: names.get(c.changedBy)! }
      : null,
  changedAt: c.changedAt.toISOString(),
});
