import type { Metadata } from 'next';
import Link from 'next/link';
import { cms } from '../../../src/lib/cms';

export const metadata: Metadata = {
  title: 'Blog',
  description: 'Notes on running construction projects in Australia, and what we are building.',
};

const dateFmt = new Intl.DateTimeFormat('en-AU', {
  dateStyle: 'long',
  timeZone: 'Australia/Sydney',
});

export default async function BlogIndex() {
  const payload = await cms();
  const { docs } = await payload.find({
    collection: 'posts',
    where: { _status: { equals: 'published' } },
    sort: '-publishedAt',
    limit: 50,
    depth: 1,
  });
  return (
    <>
      <h1>Blog</h1>
      {docs.length === 0 ? (
        <p className="muted">No posts yet. Check back soon.</p>
      ) : (
        <ul className="grid">
          {docs.map((p) => (
            <li key={p.id} className="card">
              <p className="muted">
                {p.kind === 'caseStudy' ? 'Case study' : (p.category ?? 'Blog')}
                {p.publishedAt ? ` · ${dateFmt.format(new Date(p.publishedAt))}` : ''}
              </p>
              <h2>
                <Link href={`/blog/${p.slug}`}>{p.title}</Link>
              </h2>
              <p>{p.excerpt}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
