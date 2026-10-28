// Prices are never typed into the CMS (WEB-AC6, X57). The site reads the published price book from the API
// (`GET /v1/public/price-book`, edited in the owner console). When SITE_API_URL isn't set (plain local run), or the
// API is unreachable, it shows the founding price list john approved on 2 Oct 2026, so the page always renders.

export interface PricePlan {
  id: string;
  name: string;
  /** Headline price, ex GST, already formatted. */
  price: string;
  unit: string;
  blurb: string;
  features: string[];
  cta: { label: string; href: string };
}

export interface PriceBook {
  version: string;
  source: 'api' | 'fallback';
  /** Shown under the table until Sam confirms the GST display rule. */
  gstNote: string;
  plans: PricePlan[];
}

export const FALLBACK_PRICE_BOOK: PriceBook = {
  version: 'founding-2026-10',
  source: 'fallback',
  gstNote: 'All prices are in Australian dollars and exclude GST.',
  plans: [
    {
      id: 'subcontractor',
      name: 'Subcontractor',
      price: 'Free',
      unit: 'always',
      blurb: 'For the trades and suppliers your builder invites.',
      features: [
        'Respond to RFIs and submittals',
        'Site sign-in and inductions',
        'Compliance wallet',
      ],
      cta: { label: 'Ask for an invite', href: '/demo' },
    },
    {
      id: 'team',
      name: 'Team',
      price: 'A$99',
      unit: 'per user per month',
      blurb: 'For small builders running their own projects.',
      features: [
        'Documents, drawings and markups',
        'RFIs, site diary and defects',
        'Ask Nova included, with a monthly allowance',
        'Mobile apps with offline sync',
      ],
      cta: { label: 'Request a demo', href: '/demo' },
    },
    {
      id: 'business',
      name: 'Business',
      price: 'From A$24,000',
      unit: 'per year',
      blurb: 'For growing builders with several projects and teams.',
      features: [
        'Everything in Team',
        'Workforce sign-in and timesheets',
        'Variations, claims and Security of Payment',
        'Single sign-on and audit log',
      ],
      cta: { label: 'Talk to sales', href: '/demo' },
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      price: 'From A$129,000',
      unit: 'per year',
      blurb: 'For large contractors with their own security needs.',
      features: [
        'Everything in Business',
        'Bring your own AI key',
        'Dedicated onboarding and support',
        'Custom retention and data controls',
      ],
      cta: { label: 'Talk to sales', href: '/demo' },
    },
  ],
};

/** The published price book as the API returns it (`GET /v1/public/price-book`). */
export interface ApiPriceBook {
  version: string;
  currency: 'AUD';
  gstIncluded: boolean;
  plans: Array<{
    code: string;
    name: string;
    blurb: string;
    features: string[];
    cta: { label: string; href: string };
    price: { unit: 'free' | 'user_month' | 'year'; fromPrice: boolean; amountCents: number | null };
  }>;
}

const audFormat = (digits: 0 | 2) =>
  new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const aud0 = audFormat(0);
const aud2 = audFormat(2);

export function formatPrice(price: ApiPriceBook['plans'][number]['price']): {
  price: string;
  unit: string;
} {
  if (price.unit === 'free' || price.amountCents === null) return { price: 'Free', unit: 'always' };
  // Whole dollars drop the cents (A$99); odd cents keep them (A$99.50). The symbol reads "A$" in en-AU.
  const dollars = price.amountCents / 100;
  const money = (Number.isInteger(dollars) ? aud0 : aud2).format(dollars).replace(/^\$/, 'A$');
  return {
    price: price.fromPrice ? `From ${money}` : money,
    unit: price.unit === 'user_month' ? 'per user per month' : 'per year',
  };
}

export function fromApi(api: ApiPriceBook): PriceBook {
  return {
    version: api.version,
    source: 'api',
    gstNote: api.gstIncluded
      ? 'All prices are in Australian dollars and include GST.'
      : FALLBACK_PRICE_BOOK.gstNote,
    plans: api.plans.map((p) => ({
      id: p.code,
      name: p.name,
      blurb: p.blurb,
      features: p.features,
      cta: p.cta,
      ...formatPrice(p.price),
    })),
  };
}

export async function getPriceBook(): Promise<PriceBook> {
  const base = process.env.SITE_API_URL;
  if (!base) return FALLBACK_PRICE_BOOK;
  try {
    const res = await fetch(new URL('/v1/public/price-book', base), { next: { revalidate: 60 } });
    if (!res.ok) return FALLBACK_PRICE_BOOK;
    const api = (await res.json()) as ApiPriceBook;
    return api.plans.length ? fromApi(api) : FALLBACK_PRICE_BOOK;
  } catch {
    return FALLBACK_PRICE_BOOK;
  }
}
