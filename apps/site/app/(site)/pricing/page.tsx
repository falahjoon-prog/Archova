import type { Metadata } from 'next';
import { Blocks } from '../../../src/components/Blocks';
import { PricingTable } from '../../../src/components/PricingTable';
import { getPage } from '../../../src/lib/cms';
import { toMetadata } from '../../../src/lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const page = await getPage('pricing');
  return toMetadata('Pricing', page?.seo);
}

// Editors write the words around the table in the "pricing" page; the numbers always come from the price book.
export default async function Pricing() {
  const page = await getPage('pricing');
  if (!page) {
    return (
      <>
        <h1>Pricing</h1>
        <PricingTable />
      </>
    );
  }
  return <Blocks layout={page.layout} />;
}
