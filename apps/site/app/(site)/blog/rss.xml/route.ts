import { cms, SITE_ORIGIN } from '../../../../src/lib/cms';

export const dynamic = 'force-dynamic';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function GET() {
  const payload = await cms();
  const { docs } = await payload.find({
    collection: 'posts',
    where: { _status: { equals: 'published' } },
    sort: '-publishedAt',
    limit: 50,
  });
  const items = docs
    .map(
      (p) =>
        `<item><title>${esc(p.title)}</title><link>${SITE_ORIGIN}/blog/${p.slug}</link><guid>${SITE_ORIGIN}/blog/${p.slug}</guid>` +
        `<description>${esc(p.excerpt)}</description>${p.publishedAt ? `<pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate>` : ''}</item>`,
    )
    .join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Archova blog</title><link>${SITE_ORIGIN}/blog</link><description>Notes from the Archova team.</description>${items}</channel></rss>`;
  return new Response(xml, { headers: { 'content-type': 'application/rss+xml; charset=utf-8' } });
}
