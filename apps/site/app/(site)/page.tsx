import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Blocks } from '../../src/components/Blocks';
import { getPage } from '../../src/lib/cms';
import { toMetadata } from '../../src/lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const page = await getPage('home');
  return page ? toMetadata('Archova', page.seo) : {};
}

export default async function Home() {
  const page = await getPage('home');
  if (!page) notFound();
  return <Blocks layout={page.layout} />;
}
