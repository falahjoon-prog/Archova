// Provider-neutral accounting model (integrations/02 §2). Money is integer cents; no floats cross this boundary.

export type AccountingProviderName = 'xero' | 'myob';
export type LedgerKind = 'bill' | 'invoice';

export interface LedgerLine {
  description: string;
  costCode: string;
  // Excludes GST.
  amountCents: number;
  gstCents: number;
}

// One thing to push: a subcontractor payment schedule (bill, A4) or a head-contract claim (invoice, A5).
export interface LedgerDocument {
  kind: LedgerKind;
  // `PC-{contract}-{claim no}`: searched before every create so a retry never duplicates (integrations/02 §4).
  reference: string;
  contactRemoteId: string;
  // YYYY-MM-DD; dates are never shifted silently (SOPA dates matter).
  date: string;
  dueDate: string;
  lines: LedgerLine[];
  // Positive number held back; pushed as a separate negative line to the retention account.
  retentionCents: number;
  status: 'draft' | 'awaiting_approval';
}

export interface AccountTarget {
  accountRef: string;
  taxRef: string;
  trackingRef?: string;
}

// The admin's field map (A3). An unmapped cost code blocks the push and becomes a sync issue.
export interface FieldMap {
  accounts: Readonly<Record<string, AccountTarget>>;
  retention: AccountTarget;
}

export type PushResult =
  | {
      outcome: 'created' | 'updated';
      remoteId: string;
      remoteVersion: string;
      remoteStatus: string;
    }
  // The remote document is past draft: Archova never edits it, a person decides (integrations/02 §3).
  | { outcome: 'locked'; remoteId: string; remoteVersion: string; remoteStatus: string };

// A payment fact pulled back (A7). Append-only; a reversal is a new row with a negative amount.
export interface RemotePayment {
  remoteId: string;
  documentReference: string;
  paidOn: string;
  amountCents: number;
}

export type ContactRole = 'supplier' | 'customer';

export interface AccountingProvider {
  readonly name: AccountingProviderName;
  // The remote supplier or customer for a company (A1): by ABN when it has one, with no name fallback; by exact name
  // only when it has no ABN. Null when nothing matches.
  findContact(
    q: { abn: string | null; name: string },
    role: ContactRole,
  ): Promise<{ remoteId: string; matchedBy: 'abn' | 'name' } | null>;
  push(doc: LedgerDocument, map: FieldMap): Promise<PushResult>;
  paymentsSince(since: Date): Promise<RemotePayment[]>;
}

export class UnmappedCostCodeError extends Error {
  constructor(readonly costCodes: string[]) {
    super(`No account mapped for cost code ${costCodes.join(', ')}`);
  }
}

export class ProviderRequestError extends Error {
  constructor(
    readonly provider: AccountingProviderName,
    readonly status: number,
    // `retryable` covers 429 and 5xx; everything else needs a person (a sync issue).
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
  }
}
