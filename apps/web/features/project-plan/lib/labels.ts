import { webRoutes } from '@archova/routes';
import type { components } from '@archova/contracts/openapi';
import type { StatusTone } from '@archova/ui';

type S = components['schemas'];
export type ProjectPlan = S['ProjectPlan'];
export type PlanPhase = S['PlanPhase'];
export type PlanItem = S['PlanItem'];
export type PlanLink = S['PlanLink'];
export type PlanParty = S['PlanParty'];
export type PlanInsights = S['ProjectPlanInsights'];
export type PlanLinkOption = S['PlanLinkOption'];
export type ItemType = S['PlanItemType'];
export type ItemStatus = S['PlanItemStatus'];
export type LinkType = S['PlanLinkType'];

export const ITEM_TYPES: readonly ItemType[] = [
  'document',
  'checklist',
  'inspection',
  'meeting',
  'signed_document',
  'application',
  'notification',
  'hold_point',
];
export const TYPE_LABELS: Record<ItemType, string> = {
  document: 'Document',
  checklist: 'Checklist',
  inspection: 'Inspection',
  meeting: 'Meeting',
  signed_document: 'Signed document',
  application: 'Application',
  notification: 'Notification',
  hold_point: 'Hold point',
};
export const STATUS_LABELS: Record<ItemStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  complete: 'Complete',
};
export const STATUS_TONE: Record<ItemStatus, StatusTone> = {
  not_started: 'neutral',
  in_progress: 'info',
  complete: 'success',
};
export const LINK_LABELS: Record<LinkType, string> = {
  rfi: 'RFI',
  submittal: 'Submittal',
  inspection: 'Inspection',
  meeting: 'Meeting',
  drawing: 'Drawing',
  document: 'Document',
  correspondence: 'Correspondence',
  defect: 'Defect',
  esign_envelope: 'Signature request',
};

/** The record kind each item type links to; the panel offers "Link …" and "Create new" for these. */
export const TYPE_LINK: Partial<Record<ItemType, LinkType>> = {
  inspection: 'inspection',
  checklist: 'inspection',
  meeting: 'meeting',
  document: 'document',
  signed_document: 'esign_envelope',
};

/** Linkable kinds the API can list today. Signature requests join when the e-signature screens land. */
export const LISTABLE_LINKS: readonly LinkType[] = [
  'inspection',
  'meeting',
  'document',
  'rfi',
  'submittal',
  'correspondence',
  'defect',
];

/** Where "Create new" goes for a kind of record. */
export function createRoute(type: LinkType, orgSlug: string, projectId: string): string | null {
  switch (type) {
    case 'inspection':
      return webRoutes.inspections(orgSlug, projectId);
    case 'meeting':
      return webRoutes.meetings(orgSlug, projectId);
    case 'document':
      return webRoutes.correspondence(orgSlug, projectId);
    case 'rfi':
      return webRoutes.rfis(orgSlug, projectId);
    case 'submittal':
      return webRoutes.newSubmittal(orgSlug, projectId);
    case 'correspondence':
      return webRoutes.newCorrespondence(orgSlug, projectId);
    case 'defect':
      return webRoutes.newDefect(orgSlug, projectId);
    default:
      return null;
  }
}

/** Where a linked record opens. */
export function openRoute(link: PlanLink, orgSlug: string, projectId: string): string | null {
  switch (link.type) {
    case 'rfi':
      return webRoutes.rfi(orgSlug, projectId, link.id);
    case 'submittal':
      return webRoutes.submittal(orgSlug, projectId, link.id);
    case 'inspection':
      return webRoutes.inspections(orgSlug, projectId, link.id);
    case 'meeting':
      return webRoutes.meeting(orgSlug, projectId, link.id);
    case 'correspondence':
      return webRoutes.correspondenceItem(orgSlug, projectId, link.id);
    case 'defect':
      return webRoutes.defect(orgSlug, projectId, link.id);
    default:
      return null;
  }
}

/** Colour of a linked record's current status: closed things read green, trouble reads red. */
export function linkTone(status: string | null): StatusTone {
  if (!status) return 'neutral';
  if (/closed|complete|approved|issued|answered|passed|accepted/.test(status)) return 'success';
  if (/overdue|failed|rejected|disputed|void/.test(status)) return 'danger';
  if (/draft|open|pending|in_progress|submitted|review/.test(status)) return 'info';
  return 'neutral';
}

export const humanise = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** `2 of 5 complete`, and the share for the progress bar. */
export const progress = (p: PlanPhase) => ({
  done: p.doneCount,
  total: p.items.length,
  pct: p.items.length === 0 ? 0 : Math.round((p.doneCount / p.items.length) * 100),
});
