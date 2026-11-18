import type { MarkupVisibility } from '@archova/markup';

export { invalidShape, type StoredShape } from '@archova/markup';

/** Who sees a markup (X12): the author always; their company for `company`; everyone for `project`. */
export function canSeeMarkup(
  m: { ownerId: string; ownerCompanyId: string | null; visibility: MarkupVisibility },
  viewer: { userId: string; companyId: string | null },
): boolean {
  if (m.ownerId === viewer.userId) return true;
  if (m.visibility === 'project') return true;
  return (
    m.visibility === 'company' && viewer.companyId !== null && m.ownerCompanyId === viewer.companyId
  );
}
