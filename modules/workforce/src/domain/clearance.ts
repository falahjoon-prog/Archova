import type { EligibilityReason } from './attendance';

// Site clearance: one answer to "is this person cleared to be on site today?" built from the worker's own
// record, their wallet cards, the site induction and the SWMS their company works under. Pure rules; the
// service gathers the facts. Rule-based on purpose: no model call and no credit cost, so it can run on every scan.

export type ClearanceCheckKey =
  'worker' | 'white_card' | 'licences' | 'induction' | 'swms' | 'insurance';
export type ClearanceStatus = 'pass' | 'warn' | 'fail' | 'na';
export type ClearanceResult = 'cleared' | 'warning' | 'blocked';

export interface ClearanceCheck {
  key: ClearanceCheckKey;
  label: string;
  status: ClearanceStatus;
  detail: string;
}

export interface ClearanceFlag {
  severity: 'warning' | 'blocking';
  title: string;
  detail: string;
  suggestedAction: string;
}

export interface ClearanceCredential {
  kind: string;
  expiresOn: string | null;
}

/** What `safety` reports about the SWMS the worker's company works under on this project. */
export interface ClearanceSwms {
  number: number;
  title: string;
  status: 'accepted' | 'awaiting_review' | 'rejected';
  expired: boolean;
  /** Null when the worker has no login to acknowledge with. */
  acknowledged: boolean | null;
}

/** What `insurance` reports about the worker's company on this project: certificates of currency and bonds. */
export interface ClearanceInsurance {
  state: 'cleared' | 'warning' | 'blocked';
  /** False when the project has set no requirements and nothing is recorded, so there is nothing to check. */
  checked: boolean;
  messages: { level: 'blocking' | 'warning'; text: string }[];
}

export interface ClearanceFacts {
  /** Today in the project's time zone, `yyyy-mm-dd`. */
  today: string;
  workerActive: boolean;
  credentials: ClearanceCredential[];
  /** Reasons from the induction source (X54): `induction.*` and `white_card.missing`; null if no site is set up. */
  inductionReasons: EligibilityReason[] | null;
  swms: ClearanceSwms[];
  /** Null when the worker has no company or the insurance register is not connected. */
  insurance?: ClearanceInsurance | null;
}

export interface ClearanceOutcome {
  result: ClearanceResult;
  checks: ClearanceCheck[];
  flag: ClearanceFlag | null;
}

/** Credentials that stop being valid within this many days are shown as a warning. */
export const EXPIRY_WARNING_DAYS = 30;

const CREDENTIAL_LABEL: Record<string, string> = {
  white_card: 'White card',
  high_risk_licence: 'High-risk licence',
  trade_licence: 'Trade licence',
  other: 'Other card',
};

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function evaluateClearance(f: ClearanceFacts): ClearanceOutcome {
  const checks: ClearanceCheck[] = [];
  const horizon = addDays(f.today, EXPIRY_WARNING_DAYS);
  const has = (code: string) => f.inductionReasons?.some((r) => r.code === code) ?? false;

  checks.push(
    f.workerActive
      ? { key: 'worker', label: 'Worker record', status: 'pass', detail: 'Active' }
      : { key: 'worker', label: 'Worker record', status: 'fail', detail: 'Marked inactive' },
  );

  // White card: absent, expired, or close to expiring. The induction source already reports "missing".
  const cards = f.credentials.filter((c) => c.kind === 'white_card');
  const liveCard = cards.find((c) => !c.expiresOn || c.expiresOn >= f.today);
  if (!cards.length || has('white_card.missing'))
    checks.push({
      key: 'white_card',
      label: 'White card',
      status: 'fail',
      detail: 'No white card recorded',
    });
  else if (!liveCard)
    checks.push({
      key: 'white_card',
      label: 'White card',
      status: 'fail',
      detail: `Expired ${cards
        .map((c) => c.expiresOn)
        .sort()
        .at(-1)}`,
    });
  else if (liveCard.expiresOn && liveCard.expiresOn <= horizon)
    checks.push({
      key: 'white_card',
      label: 'White card',
      status: 'warn',
      detail: `Expires ${liveCard.expiresOn}`,
    });
  else checks.push({ key: 'white_card', label: 'White card', status: 'pass', detail: 'Current' });

  // Other wallet cards: an expired licence blocks, one about to expire warns.
  const others = f.credentials.filter((c) => c.kind !== 'white_card' && c.expiresOn);
  const expired = others.filter((c) => c.expiresOn! < f.today);
  const soon = others.filter((c) => c.expiresOn! >= f.today && c.expiresOn! <= horizon);
  if (expired.length)
    checks.push({
      key: 'licences',
      label: 'Licences and cards',
      status: 'fail',
      detail: expired
        .map((c) => `${CREDENTIAL_LABEL[c.kind] ?? c.kind} expired ${c.expiresOn}`)
        .join('; '),
    });
  else if (soon.length)
    checks.push({
      key: 'licences',
      label: 'Licences and cards',
      status: 'warn',
      detail: soon
        .map((c) => `${CREDENTIAL_LABEL[c.kind] ?? c.kind} expires ${c.expiresOn}`)
        .join('; '),
    });
  else
    checks.push({
      key: 'licences',
      label: 'Licences and cards',
      status: others.length ? 'pass' : 'na',
      detail: others.length ? 'All in date' : 'None recorded',
    });

  // Site induction for this project.
  if (f.inductionReasons === null)
    checks.push({
      key: 'induction',
      label: 'Site induction',
      status: 'na',
      detail: 'No site set up on this project',
    });
  else if (has('induction.missing'))
    checks.push({
      key: 'induction',
      label: 'Site induction',
      status: 'fail',
      detail: 'Not completed for this project',
    });
  else if (has('induction.outdated'))
    checks.push({
      key: 'induction',
      label: 'Site induction',
      status: 'fail',
      detail: 'A newer induction version is required',
    });
  else if (has('induction.expired'))
    checks.push({
      key: 'induction',
      label: 'Site induction',
      status: 'fail',
      detail: 'Induction has expired',
    });
  else
    checks.push({ key: 'induction', label: 'Site induction', status: 'pass', detail: 'Completed' });

  // SWMS the worker's company works under: the worker must have acknowledged the current accepted revision.
  const accepted = f.swms.filter((s) => s.status === 'accepted' && !s.expired);
  const notAcked = accepted.filter((s) => s.acknowledged === false);
  if (notAcked.length)
    checks.push({
      key: 'swms',
      label: 'SWMS sign-off',
      status: 'fail',
      detail: `Not yet read: ${notAcked.map((s) => `SWMS #${s.number} ${s.title}`).join('; ')}`,
    });
  else if (!accepted.length)
    checks.push({
      key: 'swms',
      label: 'SWMS sign-off',
      status: f.swms.length ? 'warn' : 'na',
      detail: f.swms.length
        ? 'Company SWMS is not currently accepted'
        : 'No SWMS on file for this company',
    });
  else
    checks.push({
      key: 'swms',
      label: 'SWMS sign-off',
      status: 'pass',
      detail: accepted.some((s) => s.acknowledged === null)
        ? 'Company SWMS accepted (worker has no login to sign)'
        : 'Read and acknowledged',
    });

  // The worker's company's insurance and bonds: a missing or expired certificate blocks the company's workers.
  const ins = f.insurance;
  if (!ins || !ins.checked)
    checks.push({
      key: 'insurance',
      label: 'Company insurance',
      status: 'na',
      detail: ins ? 'No insurance requirements set for this project' : 'No company on record',
    });
  else if (ins.state === 'cleared')
    checks.push({
      key: 'insurance',
      label: 'Company insurance',
      status: 'pass',
      detail: 'Certificates and bonds in date',
    });
  else
    checks.push({
      key: 'insurance',
      label: 'Company insurance',
      status: ins.state === 'blocked' ? 'fail' : 'warn',
      detail: ins.messages
        .filter((m) => (ins.state === 'blocked' ? m.level === 'blocking' : true))
        .map((m) => m.text.replace(/\.$/, ''))
        .join('; '),
    });

  const failed = checks.filter((c) => c.status === 'fail');
  const warned = checks.filter((c) => c.status === 'warn');
  const result: ClearanceResult = failed.length ? 'blocked' : warned.length ? 'warning' : 'cleared';
  return { result, checks, flag: flagFor(failed, warned) };
}

const ACTION: Record<ClearanceCheckKey, string> = {
  worker: 'Ask the site manager to reactivate the worker before entry.',
  white_card: 'Hold at the gate until a current white card is recorded.',
  licences: 'Stop high-risk work for this person until the licence is renewed and recorded.',
  induction: 'Send them the site induction link and hold entry until it is signed.',
  insurance: 'Hold the company at the gate until a current certificate or bond is recorded.',
  swms: 'Have them open and acknowledge the SWMS on their phone before starting work.',
};

/** The one thing the gate should say out loud: the first blocking gap, otherwise the first warning. */
function flagFor(failed: ClearanceCheck[], warned: ClearanceCheck[]): ClearanceFlag | null {
  const first = failed[0] ?? warned[0];
  if (!first) return null;
  const all = [...failed, ...warned];
  const extra = all.length > 1 ? ` (${all.length - 1} more)` : '';
  return {
    severity: failed.length ? 'blocking' : 'warning',
    title: `${first.label}: ${first.detail}${extra}`,
    detail: all.map((c) => `${c.label}: ${c.detail}`).join('. '),
    suggestedAction: failed.length
      ? ACTION[first.key]
      : `Let them in, and remind them: ${first.label.toLowerCase()} — ${first.detail.toLowerCase()}.`,
  };
}
