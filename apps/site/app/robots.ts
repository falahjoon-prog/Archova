import type { MetadataRoute } from 'next';
import { SITE_ORIGIN } from '../src/lib/cms';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/cms', '/api'] },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
