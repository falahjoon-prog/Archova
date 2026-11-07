import type { ItemType } from './plan';

export interface TemplateItem {
  title: string;
  outcome: string;
  types: ItemType[];
  /** Days after the plan starts. */
  dueOffsetDays: number;
  internal?: boolean;
  thirdParty?: boolean;
}
export interface TemplatePhase {
  title: string;
  items: TemplateItem[];
}

const t = (
  title: string,
  outcome: string,
  types: ItemType[],
  dueOffsetDays: number,
  who: 'internal' | 'third_party' | 'both' = 'internal',
): TemplateItem => ({
  title,
  outcome,
  types,
  dueOffsetDays,
  internal: who !== 'third_party',
  thirdParty: who !== 'internal',
});

/** The starter plan: a building project from first idea to close-out. Everything in it can be edited or removed. */
export const STANDARD_PLAN: readonly TemplatePhase[] = [
  {
    title: 'Feasibility',
    items: [
      t('Project brief and budget envelope', 'Approved by the owner', ['document'], 14),
      t('Site selection', 'Acceptable per company guidelines', ['document', 'meeting'], 28),
      t(
        'Feasibility study',
        'Acceptable per company guidelines',
        ['document', 'hold_point'],
        45,
        'both',
      ),
    ],
  },
  {
    title: 'Due diligence and research',
    items: [
      t('Site investigation report', 'Received and reviewed', ['document'], 60, 'third_party'),
      t('Phase I ESA', 'No RECs', ['checklist', 'inspection'], 75, 'third_party'),
      t(
        'Geotechnical survey',
        'No substantial risks (as defined by company guidelines)',
        ['signed_document'],
        90,
        'third_party',
      ),
    ],
  },
  {
    title: 'Entitlements',
    items: [
      t(
        'Community outreach',
        'Standard notification steps completed',
        ['meeting', 'notification'],
        100,
        'third_party',
      ),
      t(
        'Planning or land use permit',
        'Receipt of signed permit',
        ['signed_document', 'application'],
        130,
        'third_party',
      ),
      t('Entitlements sign-off', 'All approvals in hand', ['hold_point'], 140),
    ],
  },
  {
    title: 'Design development',
    items: [
      t('Concept design approved', 'Signed off by the owner', ['signed_document'], 170),
      t('Design coordination review', 'No open clashes', ['meeting', 'checklist'], 200, 'both'),
      t('Building permit application', 'Permit issued', ['application'], 220, 'third_party'),
    ],
  },
  {
    title: 'Procurement',
    items: [
      t('Tender packages issued', 'All trade packages out', ['document', 'notification'], 240),
      t(
        'Contracts executed',
        'All subcontracts signed',
        ['signed_document', 'hold_point'],
        270,
        'both',
      ),
    ],
  },
  {
    title: 'Construction',
    items: [
      t('Site establishment', 'Site safe and ready to build', ['checklist', 'inspection'], 290),
      t(
        'Practical completion',
        'Certificate issued',
        ['inspection', 'signed_document', 'hold_point'],
        540,
        'both',
      ),
    ],
  },
  {
    title: 'Close-out',
    items: [
      t('Defects rectified', 'No open defects', ['checklist'], 570),
      t('As-built and manuals handed over', 'Received and filed', ['document'], 580),
      t('Final account agreed', 'Signed by all parties', ['signed_document'], 600, 'both'),
    ],
  },
];
