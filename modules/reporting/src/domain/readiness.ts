// Tender-readiness pack rules. Pure, no IO.
//
// Wording follows compliance/08: documents are "recorded" or "sighted", never "verified", because no register has been
// queried; retention-trust requirements are "likely" until the state rules are reviewed.

export type ExpiryState = 'current' | 'expiring' | 'expired' | 'no_expiry';

export interface PrequalSection {
  restricted: boolean;
  companies: number;
  qualified: number;
  expiring: number;
  pending: number;
  expired: number;
  notQualified: number;
  requiredForTenders: boolean;
}

export interface CredentialItem {
  itemType: string;
  title: string;
  insurer: string | null;
  expiresOn: string | null;
  evidence: 'recorded' | 'sighted' | 'self_declared';
  state: ExpiryState;
}

export interface CredentialSection {
  restricted: boolean;
  current: number;
  expiring: number;
  expired: number;
  noExpiry: number;
  items: CredentialItem[];
}

export interface SafetySection {
  /** Projects counted, and projects left out because the caller may not read their safety records. */
  projectsCovered: number;
  projectsRestricted: number;
  incidents: {
    total: number;
    notifiable: number;
    notClosed: number;
    high: number;
    critical: number;
  };
  swms: { accepted: number; expired: number; awaitingReview: number; rejected: number };
}

export interface TrustSection {
  projectsCovered: number;
  projectsRestricted: number;
  subcontracts: number;
  ok: number;
  shortfall: number;
  notSetUp: number;
  notRequired: number;
  shortfallCents: number;
}

export interface ReadinessPack {
  generatedOn: string;
  timeZone: string;
  prequal: PrequalSection;
  credentials: CredentialSection;
  safety: SafetySection;
  trust: TrustSection;
  /** True when more projects matched than the pack covers. */
  truncated: boolean;
}

export interface Attention {
  area: 'prequal' | 'credentials' | 'safety' | 'trust';
  text: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What a reader should look at first, most important first. Empty means nothing stands out. */
export function attentionItems(p: ReadinessPack): Attention[] {
  const out: Attention[] = [];
  if (!p.credentials.restricted) {
    if (p.credentials.expired > 0)
      out.push({
        area: 'credentials',
        text: `${plural(p.credentials.expired, 'licence or insurance', 'licences or insurances')} past expiry.`,
      });
    if (p.credentials.expiring > 0)
      out.push({
        area: 'credentials',
        text: `${plural(p.credentials.expiring, 'licence or insurance', 'licences or insurances')} expiring within 30 days.`,
      });
  }
  if (!p.prequal.restricted) {
    if (p.prequal.expired > 0)
      out.push({
        area: 'prequal',
        text: `${plural(p.prequal.expired, 'company', 'companies')} with an expired prequalification.`,
      });
    if (p.prequal.notQualified > 0)
      out.push({
        area: 'prequal',
        text: `${plural(p.prequal.notQualified, 'company', 'companies')} not approved.`,
      });
  }
  if (p.trust.shortfall + p.trust.notSetUp > 0)
    out.push({
      area: 'trust',
      text: `${plural(p.trust.shortfall, 'subcontract')} short in trust and ${plural(p.trust.notSetUp, 'subcontract')} with no trust account recorded.`,
    });
  if (p.safety.incidents.critical > 0)
    out.push({
      area: 'safety',
      text: `${plural(p.safety.incidents.critical, 'critical incident')} in the last 12 months.`,
    });
  if (p.safety.swms.expired > 0)
    out.push({
      area: 'safety',
      text: `${plural(p.safety.swms.expired, 'accepted SWMS', 'accepted SWMS')} past expiry.`,
    });
  return out;
}

export const ITEM_LABELS: Record<string, string> = {
  contractor_licence: 'Contractor licence',
  trade_licence: 'Trade licence',
  workers_comp: "Workers' compensation",
  public_liability: 'Public liability',
  contract_works: 'Contract works',
  professional_indemnity: 'Professional indemnity',
  personal_accident: 'Personal accident',
  home_warranty: 'Home warranty',
  subcontractor_statement: 'Subcontractor statement',
  plant_registration: 'Plant registration',
  test_and_tag: 'Test and tag',
  modern_slavery: 'Modern slavery statement',
  abn: 'ABN',
  other: 'Other',
};
export const itemLabel = (t: string) => ITEM_LABELS[t] ?? t;

const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface PackLine {
  style: 'title' | 'heading' | 'body' | 'small';
  text: string;
}

const STATE_TEXT: Record<ExpiryState, string> = {
  current: 'current',
  expiring: 'expiring soon',
  expired: 'EXPIRED',
  no_expiry: 'no expiry recorded',
};

const coverage = (covered: number, restricted: number) =>
  `Covers ${plural(covered, 'project')}${
    restricted ? `; ${plural(restricted, 'project')} left out (no access)` : ''
  }.`;

/** The pack as lines of text, in reading order, for the PDF. */
export function packLines(p: ReadinessPack): PackLine[] {
  const L: PackLine[] = [];
  const add = (style: PackLine['style'], text: string) => L.push({ style, text });
  add('title', 'Tender-readiness pack');
  add(
    'small',
    `Generated ${p.generatedOn} (${p.timeZone}). Figures come from records held in Archova.`,
  );
  add(
    'small',
    'Documents are recorded or sighted by the company; none has been checked against a licensing or insurer register.',
  );

  add('heading', 'Needs attention');
  const attention = attentionItems(p);
  if (attention.length === 0) add('body', 'Nothing stands out.');
  for (const a of attention) add('body', `- ${a.text}`);

  add('heading', 'Licences and insurance');
  if (p.credentials.restricted)
    add('body', 'Not shown: you do not have access to the compliance wallet.');
  else {
    const c = p.credentials;
    add(
      'body',
      `${c.current} current, ${c.expiring} expiring within 30 days, ${c.expired} expired, ${c.noExpiry} with no expiry recorded.`,
    );
    for (const i of c.items) {
      const what = i.insurer
        ? `${itemLabel(i.itemType)} - ${i.title} (${i.insurer})`
        : `${itemLabel(i.itemType)} - ${i.title}`;
      add(
        'body',
        `${what}: ${i.expiresOn ? `expires ${i.expiresOn}, ` : ''}${STATE_TEXT[i.state]} (${i.evidence.replace('_', '-')})`,
      );
    }
  }

  add('heading', 'Subcontractor prequalification');
  if (p.prequal.restricted) add('body', 'Not shown: you do not have access to prequalification.');
  else {
    const q = p.prequal;
    add('body', `${plural(q.companies, 'company', 'companies')} on record.`);
    add(
      'body',
      `${q.qualified} qualified, ${q.expiring} expiring within 30 days, ${q.pending} pending, ${q.expired} expired, ${q.notQualified} not approved.`,
    );
    add(
      'body',
      `Prequalification is ${q.requiredForTenders ? '' : 'not '}required before a tender invite.`,
    );
  }

  add('heading', 'Safety record, last 12 months');
  const s = p.safety;
  add(
    'body',
    `${plural(s.incidents.total, 'incident')} (${s.incidents.notifiable} notifiable, ${s.incidents.high} high, ${s.incidents.critical} critical); ${s.incidents.notClosed} not yet closed.`,
  );
  add(
    'body',
    `SWMS: ${s.swms.accepted} accepted and in date, ${s.swms.expired} accepted but past expiry, ${s.swms.awaitingReview} awaiting a decision, ${s.swms.rejected} rejected.`,
  );
  add('small', coverage(s.projectsCovered, s.projectsRestricted));

  add('heading', 'Retention trust compliance');
  const t = p.trust;
  add(
    'body',
    `${plural(t.subcontracts, 'subcontract')}: ${t.ok} in order, ${t.shortfall} short in trust (${dollars(t.shortfallCents)}), ${t.notSetUp} with no trust account recorded, ${t.notRequired} not likely to need a trust.`,
  );
  add(
    'small',
    'Whether a trust is required depends on state rules Archova has not yet had reviewed; "likely" is a prompt to check, not advice.',
  );
  add('small', coverage(t.projectsCovered, t.projectsRestricted));

  if (p.truncated)
    add('small', 'More projects exist than this pack covers; the first 200 by name were used.');
  return L;
}
