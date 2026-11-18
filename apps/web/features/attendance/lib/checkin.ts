// Gate QR posters carry a link, so a phone's own camera opens the check-in page; the code rides in the
// URL fragment, which browsers never send to a server. The Archova app's scanner reads the same link.

const GATE_CODE = /gqr_[0-9A-Za-z_-]{10,}/;

export function buildCheckInLink(origin: string, checkInPath: string, code: string): string {
  return `${origin}${checkInPath}#code=${encodeURIComponent(code)}`;
}

/** The gate code in a scanned or typed value: the bare code, or a check-in link that carries it. */
export function parseGateCode(scanned: string): string | null {
  const match = GATE_CODE.exec(scanned.trim());
  return match ? match[0] : null;
}

export interface CheckInMessage {
  tone: 'success' | 'warning' | 'danger';
  title: string;
  detail: string | null;
}

const REASONS: Record<string, string> = {
  'induction.missing': 'Site induction not done',
  'induction.outdated': 'Site induction has been updated; do it again',
  'induction.expired': 'Site induction has expired',
  'white_card.missing': 'White card not on file',
  'worker.inactive': 'Your sign-in access is switched off',
  'company.unconfirmed': 'Your company is waiting to be confirmed',
};

export function checkInMessage(result: {
  outcome: 'accepted' | 'blocked' | 'overridden' | 'already_on_site' | 'signed_out';
  eligibility: { reasons: { code: string; blocking: boolean }[] } | null;
}): CheckInMessage {
  const detail =
    (result.eligibility?.reasons ?? [])
      .filter((r) => r.blocking)
      .map((r) => REASONS[r.code] ?? 'See the site office')
      .join('. ') || null;
  switch (result.outcome) {
    case 'accepted':
      return { tone: 'success', title: 'You’re checked in', detail: null };
    case 'overridden':
      return { tone: 'warning', title: 'Checked in by the site manager', detail };
    case 'already_on_site':
      return { tone: 'warning', title: 'You’re already checked in', detail: null };
    case 'signed_out':
      return { tone: 'success', title: 'You’re checked out', detail: null };
    case 'blocked':
      return { tone: 'danger', title: 'See the site office before starting work', detail };
  }
}
