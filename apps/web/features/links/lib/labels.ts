import { webRoutes } from '@archova/routes';
import { LINK_ENTITY_TYPES, type LinkEntityType, type LinkReason } from '@archova/domain';

/** Plain words for each record type, singular and as a heading. */
export const TYPE_LABELS: Record<LinkEntityType, { one: string; many: string }> = {
  rfi: { one: 'RFI', many: 'RFIs' },
  defect: { one: 'Defect', many: 'Defects' },
  submittal: { one: 'Submittal', many: 'Submittals' },
  correspondence: { one: 'Correspondence', many: 'Correspondence' },
  document: { one: 'Document', many: 'Documents' },
};

export const TYPE_OPTIONS = LINK_ENTITY_TYPES.map((t) => ({
  value: t,
  label: TYPE_LABELS[t].one,
}));

/** The reason, said from the record being looked at; "this" is the record whose panel the person is reading. */
export const REASON_OPTIONS: readonly { value: LinkReason; label: string }[] = [
  { value: 'related', label: 'Is related to' },
  { value: 'caused_by', label: 'Was caused by' },
  { value: 'blocked_by', label: 'Is blocked by' },
  { value: 'responds_to', label: 'Responds to' },
  { value: 'duplicate_of', label: 'Is a duplicate of' },
  { value: 'supersedes', label: 'Supersedes' },
];

/** "in_review" → "In review". */
export const humanStatus = (status: string) => {
  const t = status.replace(/_/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Where a linked record opens. Documents have no page of their own, so they open the project's register. */
export function itemHref(
  orgSlug: string,
  projectId: string,
  item: { type: LinkEntityType; id: string },
): string {
  switch (item.type) {
    case 'rfi':
      return webRoutes.rfi(orgSlug, projectId, item.id);
    case 'defect':
      return webRoutes.defect(orgSlug, projectId, item.id);
    case 'submittal':
      return webRoutes.submittal(orgSlug, projectId, item.id);
    case 'correspondence':
      return webRoutes.correspondenceItem(orgSlug, projectId, item.id);
    case 'document':
      return webRoutes.documents(orgSlug, projectId);
  }
}
