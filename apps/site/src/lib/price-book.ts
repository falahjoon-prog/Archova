// Prices are never typed into the CMS (WEB-AC6, X57). The site reads the published price book from the API
// (`GET /v1/public/price-book`, owner console slice A1). Until that endpoint ships, or when SITE_API_URL isn't set
// (local run), it shows the founding price list john approved on 2 Oct 2026, so the page always renders.

export interface PricePlan {
  id: 'subcontractor' | 'team' | 'business' | 'enterprise';
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

export async function getPriceBook(): Promise<PriceBook> {
  const base = process.env.SITE_API_URL;
  if (!base) return FALLBACK_PRICE_BOOK;
  try {
    const res = await fetch(new URL('/v1/public/price-book', base), { next: { revalidate: 60 } });
    if (!res.ok) return FALLBACK_PRICE_BOOK;
    return { ...((await res.json()) as PriceBook), source: 'api' };
  } catch {
    return FALLBACK_PRICE_BOOK;
  }
}
