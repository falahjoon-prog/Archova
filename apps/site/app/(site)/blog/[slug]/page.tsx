import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { RichText } from '../../../../src/components/RichText';
import { cms } from '../../../../src/lib/cms';
import { toMetadata } from '../../../../src/lib/seo';

type Props = { params: Promise<{ slug: string }> };

const dateFmt = new Intl.DateTimeFormat('en-AU', {
  dateStyle: 'long',
  timeZone: 'Australia/Sydney',
});

async function getPost(slug: string) {
  const payload = await cms();
  const { docs } = await payload.find({
    collection: 'posts',
    where: { slug: { equals: slug }, _status: { equals: 'published' } },
    limit: 1,
    depth: 1,
  });
  return docs[0] ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await getPost((await params).slug);
  return post ? toMetadata(post.title, post.seo, post.excerpt) : {};
}

export default async function Post({ params }: Props) {
  const post = await getPost((await params).slug);
  if (!post) notFound();
  const author = typeof post.author === 'object' ? (post.author.name ?? post.author.email) : null;
  const hero = typeof post.heroImage === 'object' ? post.heroImage : null;
  return (
    <article className="article">
      <p className="muted">
        {post.publishedAt ? dateFmt.format(new Date(post.publishedAt)) : null}
        {author ? ` · ${author}` : null}
      </p>
      <h1>{post.title}</h1>
      {hero?.url ? (
        <Image
          src={hero.url}
          alt={hero.alt}
          width={hero.width ?? 1200}
          height={hero.height ?? 630}
          className="article__hero"
          unoptimized
        />
      ) : null}
      <RichText data={post.body} />
    </article>
  );
}
