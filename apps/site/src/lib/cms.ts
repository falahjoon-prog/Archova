import config from '@payload-config';
import { getPayload } from 'payload';
import type { SiteSetting } from '../../payload-types';

export const cms = () => getPayload({ config });

export async function getPage(slug: string, draft = false) {
  const payload = await cms();
  const res = await payload.find({
    collection: 'pages',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 1,
    draft,
    overrideAccess: draft,
  });
  return res.docs[0] ?? null;
}

export async function getSettings(): Promise<SiteSetting> {
  const payload = await cms();
  return (await payload.findGlobal({ slug: 'site-settings' })) as SiteSetting;
}

export const SITE_ORIGIN = process.env.SITE_ORIGIN ?? 'http://localhost:3007';
