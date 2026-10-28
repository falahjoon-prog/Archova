import { createHash } from 'node:crypto';
import { AppError, defineRoutes, requireTenant } from '@archova/kernel';
import type { CatalogueService } from '../application/catalogue';

export function billingRoutes(catalogue: CatalogueService) {
  return defineRoutes({
    getEntitlements: async (input) => {
      const tenant = requireTenant(input);
      const e = tenant.entitlements;
      return {
        status: 200,
        body: {
          orgId: input.params.orgId,
          plan: e.plan,
          state: e.state,
          modules: [...e.modules],
          limits: { ...e.limits },
        },
      };
    },
    // Only a published version is ever returned (security-licensing/05 §8a). The website and the in-app billing
    // screens read prices from here and nowhere else.
    getPublicPriceBook: async () => {
      const book = await catalogue.getPublicPriceBook();
      if (!book) throw new AppError('not_found', 'The price book has not been published.');
      const etag = `"${createHash('sha256').update(JSON.stringify(book)).digest('base64url').slice(0, 22)}"`;
      return {
        status: 200,
        body: book,
        headers: {
          etag,
          'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600',
        },
      };
    },
  });
}
