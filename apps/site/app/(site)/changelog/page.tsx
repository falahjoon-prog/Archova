import type { Metadata } from 'next';
import { getProductUpdates, KIND_LABEL, paragraphs } from '../../../src/lib/product-updates';

export const metadata: Metadata = {
  title: 'What’s new',
  description: 'Release notes and product updates from Archova.',
};

const dateFmt = new Intl.DateTimeFormat('en-AU', {
  dateStyle: 'long',
  timeZone: 'Australia/Sydney',
});

export default async function Changelog() {
  const updates = await getProductUpdates();
  return (
    <>
      <h1>What’s new</h1>
      {updates.length === 0 ? (
        <p className="muted">No updates yet. Check back soon.</p>
      ) : (
        <ol className="changelog">
          {updates.map((u) => (
            <li key={u.id}>
              <article>
                <p className="muted">
                  <time dateTime={u.publishedAt}>{dateFmt.format(new Date(u.publishedAt))}</time>
                  {' · '}
                  {KIND_LABEL[u.kind]}
                </p>
                <h2>{u.title}</h2>
                <p>{u.summary}</p>
                {paragraphs(u.body).map((p) => (
                  <p key={p}>{p}</p>
                ))}
              </article>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
