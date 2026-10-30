import type { StaffRole } from '@archova/contracts';

/** Permission keys `backoffice.<area>.<action>` are declared here and mapped to roles (backend 09 §2, Sam 12 §4). */
export const BACKOFFICE_PERMISSIONS = [
  'backoffice.customers.read',
  'backoffice.pricing.read',
  'backoffice.pricing.edit',
  'backoffice.pricing.approve',
  'backoffice.requests.read',
  'backoffice.requests.decide',
  'backoffice.staff.read',
  'backoffice.flags.read',
  'backoffice.flags.edit',
  'backoffice.accounts.trial',
  'backoffice.accounts.plan',
  'backoffice.accounts.suspend',
  'backoffice.accounts.credits',
  'backoffice.support.access',
] as const;
export type BackofficePermission = (typeof BACKOFFICE_PERMISSIONS)[number];

const READ: BackofficePermission[] = [
  'backoffice.customers.read',
  'backoffice.pricing.read',
  'backoffice.requests.read',
  'backoffice.flags.read',
];

export const ROLE_PERMISSIONS: Record<StaffRole, readonly BackofficePermission[]> = {
  // Support access is for Support and Security lead only; Owner, Sales and Finance never hold it (Sam 12 §4a).
  owner: BACKOFFICE_PERMISSIONS.filter((p) => p !== 'backoffice.support.access'),
  pricing_approver: [
    ...READ,
    'backoffice.pricing.edit',
    'backoffice.pricing.approve',
    'backoffice.requests.decide',
  ],
  billing_ops: [
    ...READ,
    'backoffice.pricing.edit',
    'backoffice.accounts.plan',
    'backoffice.accounts.credits',
  ],
  sales: [
    'backoffice.customers.read',
    'backoffice.pricing.read',
    'backoffice.flags.read',
    'backoffice.flags.edit',
    'backoffice.accounts.trial',
    'backoffice.accounts.plan',
  ],
  support: [
    'backoffice.customers.read',
    'backoffice.requests.read',
    'backoffice.flags.read',
    'backoffice.flags.edit',
    'backoffice.accounts.trial',
    'backoffice.support.access',
  ],
  security_lead: [
    ...READ,
    'backoffice.staff.read',
    'backoffice.accounts.suspend',
    'backoffice.support.access',
  ],
  finance_read: READ,
};

export function permissionsFor(roles: readonly StaffRole[]): string[] {
  return [...new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? []))].sort();
}
