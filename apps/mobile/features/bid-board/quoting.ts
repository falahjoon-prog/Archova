// Quoting from the phone: the amounts a subcontractor typed against a package's scope become the quote's lines.
// Pure, so the rules are tested without a screen.

export interface ScopeLineLike {
  key: string;
  description: string;
  quantity: string | null;
  unit: string;
}

export interface QuoteDraft {
  amounts: Readonly<Record<string, string>>;
  /** For work the scope does not name, or the whole price when the package has no scope lines. */
  lumpSum: string;
  reference: string;
  /** One qualification or exclusion per line. */
  notes: string;
}

export interface QuoteBody {
  reference?: string;
  lines: {
    scopeKey?: string;
    description: string;
    quantity?: string;
    unit?: string;
    amount: string;
  }[];
  qualifications?: { text: string }[];
}

const MONEY = /^\d{1,16}(\.\d{1,2})?$/;

/** Accepts "$12,500.5" and gives "12500.50", or null when it is not a price. */
export function cleanAmount(raw: string): string | null {
  const s = raw.replace(/[$,\s]/g, '');
  if (!MONEY.test(s)) return null;
  const [whole = '0', cents = ''] = s.split('.');
  return `${whole.replace(/^0+(?=\d)/, '')}.${cents.padEnd(2, '0')}`;
}

const toCents = (amount: string) => {
  const [w = '0', c = '00'] = amount.split('.');
  return Number(w) * 100 + Number(c.padEnd(2, '0'));
};

export type BuiltQuote =
  { ok: true; body: QuoteBody; totalCents: number } | { ok: false; problem: string };

export function buildQuote(scope: readonly ScopeLineLike[], d: QuoteDraft): BuiltQuote {
  const lines: QuoteBody['lines'] = [];
  for (const s of scope) {
    const raw = (d.amounts[s.key] ?? '').trim();
    if (!raw) continue;
    const amount = cleanAmount(raw);
    if (!amount) return { ok: false, problem: `"${raw}" is not a price for ${s.description}.` };
    lines.push({
      scopeKey: s.key,
      description: s.description,
      ...(s.quantity ? { quantity: s.quantity } : {}),
      unit: s.unit,
      amount,
    });
  }
  if (d.lumpSum.trim()) {
    const amount = cleanAmount(d.lumpSum);
    if (!amount) return { ok: false, problem: `"${d.lumpSum.trim()}" is not a price.` };
    lines.push({ description: scope.length ? 'Other work' : 'Lump sum', amount });
  }
  if (lines.length === 0) return { ok: false, problem: 'Enter at least one price.' };
  const notes = d.notes
    .split('\n')
    .map((n) => n.trim())
    .filter(Boolean)
    .slice(0, 200)
    .map((text) => ({ text: text.slice(0, 1000) }));
  const reference = d.reference.trim();
  return {
    ok: true,
    body: {
      ...(reference ? { reference: reference.slice(0, 100) } : {}),
      lines,
      ...(notes.length ? { qualifications: notes } : {}),
    },
    totalCents: lines.reduce((n, l) => n + toCents(l.amount), 0),
  };
}

/** "$12,500.00" for a number of cents. */
export function moneyText(totalCents: number): string {
  const whole = Math.floor(totalCents / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${whole}.${String(totalCents % 100).padStart(2, '0')}`;
}

const STATUS_TEXT: Record<string, string> = {
  draft: 'Draft',
  out_to_tender: 'Open for quotes',
  closed: 'Closed',
  awarded: 'Awarded',
  cancelled: 'Cancelled',
};

/** "Tiling. Open for quotes. Due 7 Nov, 4:00 pm", with the due time in the phone's own zone. */
export function packageSubtitle(p: {
  trade: string;
  status: string;
  dueAt: string | null;
}): string {
  const due = p.dueAt
    ? `Due ${new Date(p.dueAt).toLocaleString('en-AU', {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })}`
    : 'No due date';
  return [p.trade, STATUS_TEXT[p.status] ?? p.status, due].filter(Boolean).join('. ');
}
