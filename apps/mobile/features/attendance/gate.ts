// Gate sign-in rules the phone applies to what the server returns (ATT-AC7). Pure, so it runs in Node tests.
import type { SignInResult } from '@archova/contracts';

const GATE_CODE = /gqr_[0-9A-Za-z_-]{10,}/;

/** The gate code in a scanned QR: the bare token, or a link that carries it. Anything else is not ours. */
export function parseGateCode(scanned: string): string | null {
  const match = GATE_CODE.exec(scanned.trim());
  return match ? match[0] : null;
}

export interface SignInMessage {
  tone: 'success' | 'warning' | 'danger';
  title: string;
  detail: string | null;
}

const reasonLabel: Record<string, string> = {
  'induction.missing': 'Site induction not done',
  'induction.outdated': 'Site induction has been updated; do it again',
  'induction.expired': 'Site induction has expired',
  'white_card.missing': 'White card not on file',
  'worker.inactive': 'Your sign-in access is switched off',
  'company.unconfirmed': 'Your company is waiting to be confirmed',
};

export const eligibilityReasonLabel = (code: string) => reasonLabel[code] ?? 'See the site office';

export function signInMessage(result: SignInResult): SignInMessage {
  const reasons = (result.eligibility?.reasons ?? [])
    .filter((r) => r.blocking)
    .map((r) => eligibilityReasonLabel(r.code));
  const detail = reasons.length > 0 ? reasons.join('. ') : null;
  switch (result.outcome) {
    case 'accepted':
      return { tone: 'success', title: 'Signed in', detail: null };
    case 'overridden':
      return { tone: 'warning', title: 'Signed in by the site manager', detail };
    case 'already_on_site':
      return { tone: 'warning', title: 'You are already signed in', detail: null };
    case 'signed_out':
      return { tone: 'success', title: 'Signed out', detail: null };
    case 'blocked':
      return { tone: 'danger', title: 'See the site office before starting work', detail };
  }
}
