// Project risk register rules. Pure, no IO. The score, level and RAG are always derived from likelihood and impact,
// never stored, so a change to a threshold here changes every project at once.
import type { RiskStatus } from '../infra/tables';

export type RiskLevel = 'high' | 'medium' | 'low';
export type Rag = 'red' | 'amber' | 'green';

/** Score at or above which a risk is high (e.g. likelihood 3 x impact 5), and at or above which it is medium. */
export const HIGH_FROM = 15;
export const MEDIUM_FROM = 8;

export const score = (likelihood: number, impact: number) => likelihood * impact;

export function levelOf(s: number): RiskLevel {
  if (s >= HIGH_FROM) return 'high';
  return s >= MEDIUM_FROM ? 'medium' : 'low';
}

/** A risk still needing attention: closed risks no longer count, a risk that has occurred still does. */
export const isLive = (status: RiskStatus) => status !== 'closed';

export interface RiskInput {
  likelihood: number;
  impact: number;
  status: RiskStatus;
  reviewDate: string | null;
}

export interface RiskSummary {
  rag: Rag | null;
  open: number;
  high: number;
  medium: number;
  low: number;
  overdueReviews: number;
}

/**
 * The risk RAG for the project health model. Red when any live risk is high, or one has already occurred and is
 * still live; amber when any live risk is medium; green otherwise. A project that has never recorded a risk is
 * `null` (unknown), never green: an empty register is not evidence of safety.
 */
export function summarise(risks: readonly RiskInput[], today: string): RiskSummary {
  const out: RiskSummary = { rag: null, open: 0, high: 0, medium: 0, low: 0, overdueReviews: 0 };
  if (risks.length === 0) return out;
  let occurred = false;
  for (const r of risks) {
    if (!isLive(r.status)) continue;
    out.open++;
    out[levelOf(score(r.likelihood, r.impact))]++;
    if (r.status === 'occurred') occurred = true;
    if (r.reviewDate && r.reviewDate < today) out.overdueReviews++;
  }
  out.rag = out.high > 0 || occurred ? 'red' : out.medium > 0 ? 'amber' : 'green';
  return out;
}
