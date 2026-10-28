import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Blocks } from '../../../src/components/Blocks';
import { getPage } from '../../../src/lib/cms';
import { toMetadata } from '../../../src/lib/seo';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await getPage((await params).slug);
  return page ? toMetadata(page.title, page.seo) : {};
}

export default async function CmsPage({ params }: Props) {
  const page = await getPage((await params).slug);
  if (!page) notFound();
  return <Blocks layout={page.layout} />;
}
