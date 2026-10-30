import type { Tx } from '@archova/kernel';

/**
 * What platform needs from the owner console's support-access consent (Sam 12 §4a). Injected by `compose`, so
 * platform never imports `backoffice`. Each call runs inside the caller's own tenant transaction.
 */
export interface SupportAccessPort {
  status(tx: Tx, orgId: string): Promise<SupportAccessStatus>;
  banner(tx: Tx, orgId: string): Promise<{ active: boolean; since: string | null }>;
  grant(
    tx: Tx,
    orgId: string,
    by: { userId: string; name: string },
    input: { ticketRef: string; hours: number; note?: string | undefined },
  ): Promise<void>;
  revoke(tx: Tx, orgId: string): Promise<void>;
}

export interface SessionSummary {
  staffName: string;
  ticketRef: string;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  endedReason: 'staff' | 'customer_revoked' | 'expired' | null;
  pagesViewed: number;
}

export interface SupportAccessStatus {
  grant: {
    ticketRef: string;
    note: string | null;
    grantedBy: string;
    grantedAt: string;
    expiresAt: string;
  } | null;
  session: SessionSummary | null;
  history: SessionSummary[];
}
