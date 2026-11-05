// Retention and project trust (compliance/01 §7, decision D5: record and remind in phase 2). Pure; money in cents.
// The thresholds are Grace's reading of the schemes and have not been signed off by a lawyer, so every answer
// carries `rulesReviewed: false` and the wording says "likely", never "compliant".

export interface TrustRequirementInput {
  sopaState: string;
  /** Contract value in cents. */
  valueCents: number;
  governmentClient: boolean;
}

export interface TrustRequirement {
  required: boolean;
  basis: string;
  rulesReviewed: false;
}

export function trustRequirement(i: TrustRequirementInput): TrustRequirement {
  const make = (required: boolean, basis: string): TrustRequirement => ({
    required,
    basis,
    rulesReviewed: false,
  });
  switch (i.sopaState) {
    case 'QLD': {
      const threshold = i.governmentClient ? 100_000_000 : 1_000_000_000;
      return i.valueCents >= threshold
        ? make(
            true,
            `QLD project and retention trusts likely apply: ${i.governmentClient ? 'government contracts of $1,000,000' : 'other contracts of $10,000,000'} or more.`,
          )
        : make(
            false,
            'QLD trusts apply to government contracts of $1,000,000 or more and other contracts of $10,000,000 or more.',
          );
    }
    case 'WA':
      return i.valueCents >= 2_000_000
        ? make(true, 'WA retention trust likely applies: contracts of $20,000 or more.')
        : make(false, 'WA retention trust applies to contracts of $20,000 or more.');
    case 'NSW':
      return i.valueCents >= 2_000_000_000
        ? make(true, 'NSW retention trust likely applies: projects of $20,000,000 or more.')
        : make(false, 'NSW retention trust applies to projects of $20,000,000 or more.');
    default:
      return make(false, `No retention trust scheme is recorded for ${i.sopaState}.`);
  }
}

export interface MovementInput {
  id: string;
  kind: 'deposit' | 'interest' | 'release' | 'reversal';
  /** Signed cents: positive into the account. */
  amountCents: number;
  reversesMovementId: string | null;
}

export interface TrustTotals {
  balanceCents: number;
  depositedCents: number;
  interestCents: number;
  releasedCents: number;
}

/** A reversal counts against the kind of the row it reverses. */
export function trustTotals(movements: readonly MovementInput[]): TrustTotals {
  const byId = new Map(movements.map((m) => [m.id, m]));
  const t: TrustTotals = { balanceCents: 0, depositedCents: 0, interestCents: 0, releasedCents: 0 };
  for (const m of movements) {
    t.balanceCents += m.amountCents;
    const kind = m.kind === 'reversal' ? (byId.get(m.reversesMovementId!)?.kind ?? m.kind) : m.kind;
    if (kind === 'deposit') t.depositedCents += m.amountCents;
    else if (kind === 'interest') t.interestCents += m.amountCents;
    else if (kind === 'release') t.releasedCents += -m.amountCents;
  }
  return t;
}

export type TrustStatus = 'not_required' | 'not_set_up' | 'ok' | 'shortfall';

export interface TrustPosition extends TrustTotals {
  /** Retention taken from claims less what has been released to the payee. */
  requiredInTrustCents: number;
  shortfallCents: number;
  status: TrustStatus;
}

/** The retention that should sit in trust is what claims withheld, less what has been released. */
export function trustPosition(input: {
  required: boolean;
  setUp: boolean;
  retentionWithheldCents: number;
  totals: TrustTotals;
}): TrustPosition {
  const requiredInTrustCents = Math.max(
    0,
    input.retentionWithheldCents - input.totals.releasedCents,
  );
  const shortfallCents = input.required
    ? Math.max(0, requiredInTrustCents - input.totals.balanceCents)
    : 0;
  const status: TrustStatus = !input.required
    ? 'not_required'
    : !input.setUp
      ? 'not_set_up'
      : shortfallCents > 0
        ? 'shortfall'
        : 'ok';
  return { ...input.totals, requiredInTrustCents, shortfallCents, status };
}
