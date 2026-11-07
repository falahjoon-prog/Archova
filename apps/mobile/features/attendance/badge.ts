// The worker's digital Safety ID badge (workforce `getMySafetyBadge`): pure helpers and the three API calls.
import qrcode from 'qrcode-generator';
import { unwrap, type ApiClient } from '@archova/api-client';
import type { SafetyBadge } from '@archova/contracts';
import type { GateTarget } from './commands';

const base = '/v1/orgs/{orgId}/projects/{projectId}/attendance/me' as const;

export const badgeKey = (t: GateTarget) => ['safety-badge', t.orgId, t.projectId] as const;

export async function fetchBadge(api: ApiClient, t: GateTarget): Promise<SafetyBadge> {
  return unwrap(
    await api.GET(`${base}/badge`, {
      params: { path: { orgId: t.orgId, projectId: t.projectId } },
    }),
  );
}

export async function saveEmergencyContact(
  api: ApiClient,
  t: GateTarget,
  contact: { name: string; relationship?: string; phone: string } | null,
): Promise<SafetyBadge> {
  return unwrap(
    await api.PUT(`${base}/emergency-contact`, {
      params: { path: { orgId: t.orgId, projectId: t.projectId } },
      body: { contact },
    }),
  );
}

export async function saveBadgePhoto(
  api: ApiClient,
  t: GateTarget,
  fileId: string | null,
): Promise<SafetyBadge> {
  return unwrap(
    await api.PUT(`${base}/photo`, {
      params: { path: { orgId: t.orgId, projectId: t.projectId } },
      body: { fileId },
    }),
  );
}

/** "Jo Citizen" becomes "JC": shown in place of a photo. */
export function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase();
}

const KIND_LABELS: Record<string, string> = {
  white_card: 'White card',
  high_risk_licence: 'High-risk work licence',
  trade_licence: 'Trade licence',
  other: 'Other card',
};
export const credentialLabel = (kind: string) => KIND_LABELS[kind] ?? 'Card';

export type ExpiryState = 'none' | 'ok' | 'soon' | 'expired';

/** `soon` is the last 30 days. Dates are plain calendar dates compared as text. */
export function expiryState(expiresOn: string | null, today: string): ExpiryState {
  if (!expiresOn) return 'none';
  if (expiresOn < today) return 'expired';
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const soon = new Date(Date.UTC(y, m - 1, d + 30)).toISOString().slice(0, 10);
  return expiresOn <= soon ? 'soon' : 'ok';
}

export function expiryText(expiresOn: string | null, today: string): string {
  const s = expiryState(expiresOn, today);
  if (s === 'none') return 'No expiry date recorded';
  if (s === 'expired') return `Expired ${expiresOn}`;
  return `${s === 'soon' ? 'Expires soon: ' : 'Expires '}${expiresOn}`;
}

/** Dark modules of the QR code, row by row. Error correction M reads well off a cracked screen. */
export function qrMatrix(value: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

export interface ContactDraft {
  name: string;
  relationship: string;
  phone: string;
}

/** The server holds the real check; this catches typos before the round trip. */
export function contactProblem(d: ContactDraft): string | null {
  if (d.name.trim() === '') return 'Enter the contact’s name.';
  if (!/^\+?\d{8,15}$/.test(d.phone.replace(/[^\d+]/g, '')))
    return 'Enter a phone number with 8 to 15 digits.';
  return null;
}
