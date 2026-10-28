import { describe, expect, it } from 'vitest';
import { FALLBACK_PRICE_BOOK, formatPrice, fromApi, type ApiPriceBook } from './price-book';

describe('price book from the API', () => {
  it('formats prices the way the founding list shows them', () => {
    expect(formatPrice({ unit: 'free', fromPrice: false, amountCents: null })).toEqual({
      price: 'Free',
      unit: 'always',
    });
    expect(formatPrice({ unit: 'user_month', fromPrice: false, amountCents: 9900 })).toEqual({
      price: 'A$99',
      unit: 'per user per month',
    });
    expect(formatPrice({ unit: 'year', fromPrice: true, amountCents: 2400000 })).toEqual({
      price: 'From A$24,000',
      unit: 'per year',
    });
    expect(formatPrice({ unit: 'user_month', fromPrice: false, amountCents: 9950 }).price).toBe(
      'A$99.50',
    );
  });

  it('maps a published book to the page model, matching the fallback for the founding prices', () => {
    const api: ApiPriceBook = {
      version: 'founding-2026-10',
      currency: 'AUD',
      gstIncluded: false,
      plans: FALLBACK_PRICE_BOOK.plans.map((p) => ({
        code: p.id,
        name: p.name,
        blurb: p.blurb,
        features: p.features,
        cta: p.cta,
        price:
          p.id === 'subcontractor'
            ? { unit: 'free', fromPrice: false, amountCents: null }
            : p.id === 'team'
              ? { unit: 'user_month', fromPrice: false, amountCents: 9900 }
              : {
                  unit: 'year',
                  fromPrice: true,
                  amountCents: p.id === 'business' ? 2400000 : 12900000,
                },
      })),
    };
    const book = fromApi(api);
    expect(book.source).toBe('api');
    expect(book.plans).toEqual(FALLBACK_PRICE_BOOK.plans);
  });
});
