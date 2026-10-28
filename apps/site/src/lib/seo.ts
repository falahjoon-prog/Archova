import type { Metadata } from 'next';
import type { Media } from '../../payload-types';

interface Seo {
  title?: string | null;
  description?: string | null;
  image?: number | Media | null;
  canonicalUrl?: string | null;
  noindex?: boolean | null;
}

export function toMetadata(
  fallbackTitle: string,
  seo: Seo | undefined,
  fallbackDescription?: string | null,
): Metadata {
  const image = typeof seo?.image === 'object' && seo.image ? seo.image.url : undefined;
  const title = seo?.title || fallbackTitle;
  const description = seo?.description || fallbackDescription || undefined;
  return {
    title,
    description,
    alternates: seo?.canonicalUrl ? { canonical: seo.canonicalUrl } : undefined,
    robots: seo?.noindex ? { index: false, follow: false } : undefined,
    openGraph: { title, description, images: image ? [image] : undefined },
  };
}
