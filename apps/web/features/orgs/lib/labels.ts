const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  billing_admin: 'Billing admin',
  member: 'Member',
};

export function roleLabel(role: string | null, kind: 'member' | 'external'): string {
  if (kind === 'external' || role === null) return 'External collaborator';
  return ROLE_LABELS[role] ?? role;
}
