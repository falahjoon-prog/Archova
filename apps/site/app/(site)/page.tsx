import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { AppDownloadCards } from '../../src/components/AppDownloadCards';
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
  return (
    <>
      <Blocks layout={page.layout} />
      <section id="get-the-app" className="section" aria-labelledby="get-the-app-heading">
        <h2 id="get-the-app-heading">Get the app</h2>
        <p className="hero__sub">
          Archova for the field: diary, defects, drawings, sign-in and induction, working offline.
          These are test builds while we get ready for the app stores.
        </p>
        <AppDownloadCards headingLevel={3} />
        <p>
          <Link href="/app">More about the apps</Link>
        </p>
      </section>
    </>
  );
}
