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
] as const;
export type BackofficePermission = (typeof BACKOFFICE_PERMISSIONS)[number];

const READ: BackofficePermission[] = [
  'backoffice.customers.read',
  'backoffice.pricing.read',
  'backoffice.requests.read',
  'backoffice.flags.read',
];

export const ROLE_PERMISSIONS: Record<StaffRole, readonly BackofficePermission[]> = {
  owner: BACKOFFICE_PERMISSIONS,
  pricing_approver: [
    ...READ,
    'backoffice.pricing.edit',
    'backoffice.pricing.approve',
    'backoffice.requests.decide',
  ],
  billing_ops: [...READ, 'backoffice.pricing.edit'],
  sales: [
    'backoffice.customers.read',
    'backoffice.pricing.read',
    'backoffice.flags.read',
    'backoffice.flags.edit',
  ],
  support: [
    'backoffice.customers.read',
    'backoffice.requests.read',
    'backoffice.flags.read',
    'backoffice.flags.edit',
  ],
  security_lead: [...READ, 'backoffice.staff.read'],
  finance_read: READ,
};

export function permissionsFor(roles: readonly StaffRole[]): string[] {
  return [...new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? []))].sort();
}
