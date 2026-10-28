import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RichText } from '../../../../src/components/RichText';
import { cms } from '../../../../src/lib/cms';
import { toMetadata } from '../../../../src/lib/seo';

type Props = { params: Promise<{ slug: string }> };

async function getArticle(slug: string) {
  const payload = await cms();
  const { docs } = await payload.find({
    collection: 'help-articles',
    where: { slug: { equals: slug }, _status: { equals: 'published' } },
    limit: 1,
  });
  return docs[0] ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const a = await getArticle((await params).slug);
  return a ? toMetadata(a.title, a.seo, a.summary) : {};
}

export default async function HelpArticle({ params }: Props) {
  const a = await getArticle((await params).slug);
  if (!a) notFound();
  return (
    <article className="article">
      <p>
        <Link href="/help">← Help centre</Link>
      </p>
      <h1>{a.title}</h1>
      <RichText data={a.body} />
    </article>
  );
}
