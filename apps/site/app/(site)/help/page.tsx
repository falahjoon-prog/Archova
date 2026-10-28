import type { Metadata } from 'next';
import Link from 'next/link';
import { cms } from '../../../src/lib/cms';

export const metadata: Metadata = {
  title: 'Help centre',
  description: 'How to use Archova, by module.',
};

export default async function HelpIndex() {
  const payload = await cms();
  const { docs } = await payload.find({
    collection: 'help-articles',
    where: { _status: { equals: 'published' } },
    sort: 'title',
    limit: 200,
  });
  const byModule = new Map<string, typeof docs>();
  for (const d of docs) byModule.set(d.module, [...(byModule.get(d.module) ?? []), d]);
  return (
    <>
      <h1>Help centre</h1>
      {docs.length === 0 ? <p className="muted">No articles yet.</p> : null}
      {[...byModule.entries()].map(([mod, items]) => (
        <section key={mod} className="section">
          <h2>{mod.replace(/-/g, ' ')}</h2>
          <ul className="list">
            {items.map((a) => (
              <li key={a.id}>
                <Link href={`/help/${a.slug}`}>{a.title}</Link>
                <p className="muted">{a.summary}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
