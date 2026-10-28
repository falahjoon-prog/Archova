import type { MetadataRoute } from 'next';
import { cms, SITE_ORIGIN } from '../src/lib/cms';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const payload = await cms();
  const published = { _status: { equals: 'published' } } as const;
  const [pages, posts, help] = await Promise.all([
    payload.find({ collection: 'pages', where: published, limit: 500, depth: 0 }),
    payload.find({ collection: 'posts', where: published, limit: 1000, depth: 0 }),
    payload.find({ collection: 'help-articles', where: published, limit: 1000, depth: 0 }),
  ]);
  const at = (path: string, d: string) => ({
    url: `${SITE_ORIGIN}${path}`,
    lastModified: new Date(d),
  });
  return [
    ...pages.docs
      .filter((p) => !p.seo?.noindex)
      .map((p) => at(p.slug === 'home' ? '/' : `/${p.slug}`, p.updatedAt)),
    at('/blog', new Date().toISOString()),
    ...posts.docs.map((p) => at(`/blog/${p.slug}`, p.updatedAt)),
    ...help.docs.map((p) => at(`/help/${p.slug}`, p.updatedAt)),
  ];
}
