// Fills a fresh local site with starter content and a sign-in for the CMS. Safe to run again: it only adds what's missing.
// Local run only. The hosted site's staff sign in through the staff IdP (ADR-0008).
import { getPayload } from 'payload';
import config from '../payload.config';

const ADMIN_EMAIL = process.env.SITE_ADMIN_EMAIL ?? 'admin@archova.local';
const ADMIN_PASSWORD = process.env.SITE_ADMIN_PASSWORD ?? 'Archova-Local-1';

const text = (t: string) => ({
  type: 'text',
  version: 1,
  text: t,
  detail: 0,
  format: 0,
  mode: 'normal',
  style: '',
});
const para = (t: string) => ({
  type: 'paragraph',
  version: 1,
  direction: 'ltr',
  format: '',
  indent: 0,
  children: [text(t)],
});
const heading = (t: string) => ({
  type: 'heading',
  tag: 'h2',
  version: 1,
  direction: 'ltr',
  format: '',
  indent: 0,
  children: [text(t)],
});
const rich = (...children: object[]) => ({
  root: { type: 'root', version: 1, direction: 'ltr', format: '', indent: 0, children },
});

const payload = await getPayload({ config });

async function ensure(
  collection: 'pages' | 'posts' | 'help-articles',
  slug: string,
  data: Record<string, unknown>,
) {
  const found = await payload.find({
    collection,
    where: { slug: { equals: slug } },
    limit: 1,
    draft: true,
  });
  if (found.docs.length > 0) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- seed data is checked at runtime by Payload
  await payload.create({ collection, data: { slug, _status: 'published', ...data } as any });
  payload.logger.info(`Seeded ${collection}/${slug}`);
}

const users = await payload.find({ collection: 'users', limit: 1 });
let adminId: number;
if (users.docs.length === 0) {
  const u = await payload.create({
    collection: 'users',
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: 'Archova admin', role: 'admin' },
  });
  adminId = u.id;
  payload.logger.info(`Created CMS user ${ADMIN_EMAIL}`);
} else {
  adminId = users.docs[0]!.id;
}

await payload.updateGlobal({
  slug: 'site-settings',
  data: {
    headerLinks: [
      { label: 'Pricing', href: '/pricing' },
      { label: 'Blog', href: '/blog' },
      { label: 'Help', href: '/help' },
    ],
  },
});

await ensure('pages', 'home', {
  title: 'Home',
  seo: {
    title: 'Archova: construction project management for Australian builders',
    description:
      'Documents, drawings, RFIs, site diary, inductions and Ask Nova in one place, with your data kept in Australia.',
  },
  layout: [
    {
      blockType: 'hero',
      heading: 'Run every project from one place.',
      subheading:
        'Archova brings drawings, RFIs, site diaries, inductions and sign-in together for Australian builders, with Ask Nova built in and your data kept in Australia.',
      primaryLabel: 'Request a demo',
      primaryHref: '/demo',
      secondaryLabel: 'See pricing',
      secondaryHref: '/pricing',
    },
    {
      blockType: 'featureGrid',
      heading: 'Built for the site and the office',
      items: [
        {
          title: 'Drawings and documents',
          body: 'Version-controlled drawings with markups, transmittals and a document register.',
        },
        {
          title: 'RFIs and site diary',
          body: 'Raise an RFI from your phone, and keep a daily diary that fills in who was on site.',
        },
        {
          title: 'Inductions and sign-in',
          body: 'Online inductions and QR site sign-in, with records ready for an audit.',
        },
        {
          title: 'Ask Nova',
          body: 'AI help in every module. It runs only in Australia, and every plan includes a monthly allowance.',
        },
        {
          title: 'Works offline',
          body: 'The mobile apps keep working without signal and sync when you are back online.',
        },
        {
          title: 'Your data stays here',
          body: 'Hosted in Australia, with tenant isolation and an audit log.',
        },
      ],
    },
    {
      blockType: 'cta',
      heading: 'See Archova with your projects in mind',
      body: 'Book a short walk-through. No obligation.',
      label: 'Request a demo',
      href: '/demo',
    },
  ],
});

await ensure('pages', 'pricing', {
  title: 'Pricing',
  seo: {
    title: 'Pricing',
    description: 'Simple plans for subcontractors, small builders and large contractors.',
  },
  layout: [
    {
      blockType: 'hero',
      heading: 'Simple, per-company pricing',
      subheading:
        'Subcontractors are always free. Every plan includes Ask Nova with a monthly allowance, and you can top up.',
    },
    { blockType: 'pricingTable' },
    {
      blockType: 'faq',
      heading: 'Questions',
      items: [
        {
          question: 'Do my subcontractors pay?',
          answer: 'No. Subcontractors and suppliers you invite use Archova for free.',
        },
        {
          question: 'Where is my data stored?',
          answer: 'In Australia. AI processing for Ask Nova also stays in Australia.',
        },
        {
          question: 'Can I try it first?',
          answer:
            'Yes. Request a demo and we will set up a walk-through, then a pilot on your own project.',
        },
      ],
    },
  ],
});

await ensure('posts', 'welcome-to-the-archova-blog', {
  title: 'Welcome to the Archova blog',
  kind: 'blog',
  category: 'company',
  excerpt: 'What Archova is for, who we are building it with, and what you will find here.',
  author: adminId,
  publishedAt: new Date().toISOString(),
  body: rich(
    para(
      'Archova is project management built for Australian builders. We are building it in the open with a small group of pilot builders.',
    ),
    heading('What to expect'),
    para(
      'Short notes on how we handle drawings, RFIs, inductions and Security of Payment, and what changes each month.',
    ),
  ),
});

await ensure('help-articles', 'getting-started', {
  title: 'Getting started',
  module: 'getting-started',
  summary: 'Create your company, add a project and invite your team.',
  body: rich(
    para('Sign in, create your first project, then invite your team by email.'),
    para('Subcontractors you invite are free and see only the items shared with them.'),
  ),
});
await ensure('help-articles', 'raise-an-rfi', {
  title: 'Raise an RFI',
  module: 'rfis',
  summary: 'Ask a question of the design team and track the reply.',
  body: rich(
    para(
      'Open the project, choose RFIs, then New RFI. Add a drawing reference and a photo if it helps.',
    ),
  ),
});

payload.logger.info('Seed finished.');
process.exit(0);
