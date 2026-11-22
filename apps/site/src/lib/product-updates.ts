// The changelog is written in the owner console and served by `GET /v1/public/product-updates`. When SITE_API_URL
// isn't set (plain local run) or the API is unreachable the page shows an empty list rather than failing.

export interface ProductUpdate {
  id: string;
  title: string;
  summary: string;
  body: string;
  kind: 'feature' | 'improvement' | 'fix' | 'notice';
  publishedAt: string;
}

export const KIND_LABEL: Record<ProductUpdate['kind'], string> = {
  feature: 'New',
  improvement: 'Improved',
  fix: 'Fixed',
  notice: 'Notice',
};

/** Plain text from the console: a blank line starts a new paragraph. */
export function paragraphs(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export async function getProductUpdates(): Promise<ProductUpdate[]> {
  const base = process.env.SITE_API_URL;
  if (!base) return [];
  try {
    const res = await fetch(new URL('/v1/public/product-updates', base), {
      next: { revalidate: 60 },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { items?: ProductUpdate[] };
    return Array.isArray(json.items) ? json.items : [];
  } catch {
    return [];
  }
}
