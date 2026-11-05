// F34 statutory flags (ai/11 F34 item 4, compliance/08 §2): a flag is shown only for a clause that matches a SIGNED row
// of the clause-rule table. The model only finds the clause (page, clause number, quote); the wording, the provision
// and who signed the rule all come from the table. A quote that is not on its page is dropped, and a rule that is not
// signed, not for this state or contract type, or not in the list sent to the model is never flagged. Pure, no IO.
import type { ContractPage, ContractType } from '@archova/ai-prompts';
import {
  MAX_CLAUSE_CHARS,
  MAX_QUOTE_CHARS,
  MIN_QUOTE_CHARS,
  MIN_QUOTE_WORDS,
  hasBannedWord,
  locate,
  normaliseQuote,
  type ContractSource,
} from './contract-review';

export const STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'] as const;
export type State = (typeof STATES)[number];

/** Shown with every statutory section. */
export const STATUTORY_NOTE =
  "Checked against Archova's list of signed rules for this state only. Anything not on the list: not on Nova's checklist, check with your lawyer.";

export interface LegalRule {
  ruleKey: string;
  version: number;
  state: State | 'ALL';
  contractTypes: readonly string[];
  topic: string;
  detect: string;
  wording: string;
  provision: string;
  status: 'draft' | 'signed' | 'retired';
  signedBy: string | null;
  /** `YYYY-MM-DD` */
  signedOn: string | null;
}

export interface StatutoryFlag {
  ruleKey: string;
  ruleVersion: number;
  topic: string;
  provision: string;
  /** Fixed wording from the rule table, never the model's. */
  wording: string;
  signedBy: string;
  signedOn: string;
  source: ContractSource;
}

/** The latest signed version of each rule that applies to this state and contract type. */
export function applicableRules(
  rules: readonly LegalRule[],
  state: State,
  contractType: ContractType,
): LegalRule[] {
  const latest = new Map<string, LegalRule>();
  for (const r of rules) {
    if (r.status !== 'signed' || !r.signedBy || !r.signedOn) continue;
    if (r.state !== 'ALL' && r.state !== state) continue;
    if (!r.contractTypes.includes(contractType)) continue;
    const have = latest.get(r.ruleKey);
    if (!have || have.version < r.version) latest.set(r.ruleKey, r);
  }
  return [...latest.values()].sort((a, b) => a.ruleKey.localeCompare(b.ruleKey));
}

export function reviewStatutory(
  found: readonly { ruleKey: string; page: number; clause: string | null; quote: string }[],
  pages: readonly ContractPage[],
  rules: readonly LegalRule[],
): { flags: StatutoryFlag[]; dropped: number } {
  const byKey = new Map(rules.map((r) => [r.ruleKey, r]));
  const normalised = new Map(pages.map((p) => [p.page, normaliseQuote(p.text)]));
  const flags: StatutoryFlag[] = [];
  let dropped = 0;
  for (const f of found) {
    const rule = byKey.get(f.ruleKey);
    const q = f.quote.trim();
    const page = locate(q, f.page, normalised);
    if (
      !rule ||
      !rule.signedBy ||
      !rule.signedOn ||
      q.length < MIN_QUOTE_CHARS ||
      q.length > MAX_QUOTE_CHARS ||
      q.split(/\s+/).length < MIN_QUOTE_WORDS ||
      (f.clause && (f.clause.length > MAX_CLAUSE_CHARS || hasBannedWord(f.clause))) ||
      page === null
    ) {
      dropped++;
      continue;
    }
    // One flag per rule and clause, however often the model repeats it.
    if (flags.some((x) => x.ruleKey === rule.ruleKey && x.source.quote === q)) continue;
    flags.push({
      ruleKey: rule.ruleKey,
      ruleVersion: rule.version,
      topic: rule.topic,
      provision: rule.provision,
      wording: rule.wording,
      signedBy: rule.signedBy,
      signedOn: rule.signedOn,
      source: { page, clause: f.clause?.trim() || null, quote: q },
    });
  }
  flags.sort((a, b) => a.source.page - b.source.page || a.ruleKey.localeCompare(b.ruleKey));
  return { flags, dropped };
}
