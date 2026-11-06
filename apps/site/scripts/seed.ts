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

const homeData = {
  title: 'Home',
  seo: {
    title: 'Archova: construction project management for Australian builders',
    description:
      'Drawings, RFIs, site diary, defects, site sign-in and Ask Nova in one place, with your data kept in Australia.',
  },
  layout: [
    {
      blockType: 'hero',
      heading: 'One system for the *whole job*, from the office to the site gate.',
      subheading:
        'Archova gives builders, site teams, subcontractors and clients what they each need, in one place, with Ask Nova built in and your data kept in Australia.',
      primaryLabel: 'Request a demo',
      primaryHref: '/demo',
    },
    {
      blockType: 'roleSection',
      kicker: 'For builders and project managers',
      heading: 'Know where every project stands',
      body: 'Drawings, RFIs, programme, budget and claims on one project home.',
      bullets: [
        { text: 'Live RFI and defect counts' },
        { text: 'Programme with baseline and drag to reschedule' },
        { text: 'Variations and payment claims' },
      ],
      imagePath: '/home/03-project-home.jpg',
      imageAlt: 'The Archova project home screen',
    },
    {
      blockType: 'roleSection',
      kicker: 'Drawings and documents',
      heading: 'One current revision, always',
      body: 'Upload a revision and the old one is superseded, not lost. Mark up on the plan, pin an RFI or defect to the exact spot, and send a transmittal that records who received what.',
      bullets: [
        { text: 'Document and drawing register with revision history' },
        { text: 'Markups and pinned items on the drawing' },
        { text: 'Transmittals with a delivery record' },
      ],
      imagePath: '/home/05-drawings-register.jpg',
      imageAlt: 'The drawings register',
    },
    {
      blockType: 'roleSection',
      kicker: 'For site teams',
      heading: 'Capture it on the phone, in the moment',
      body: 'Photograph a defect, log the diary and raise an RFI from site. The mobile apps keep working with no signal and sync when you are back online.',
      bullets: [
        { text: 'Site diary that fills in who was on site' },
        { text: 'Defects with photos, pinned to the drawing' },
        { text: 'Works offline' },
      ],
      imagePath: '/home/09-site-diary.jpg',
      imageAlt: 'The site diary',
    },
    {
      blockType: 'roleSection',
      kicker: 'RFIs',
      heading: 'Questions answered, with a record',
      body: 'Raise an RFI with a drawing reference and a photo, route it to the right person, and track the reply against a due date.',
      bullets: [
        { text: 'Due dates and overdue flags' },
        { text: 'Linked to the drawing, spec or submittal it is about' },
      ],
      imagePath: '/home/07-rfis.jpg',
      imageAlt: 'The RFI register',
    },
    {
      blockType: 'roleSection',
      kicker: 'Site sign-in and inductions',
      heading: 'Everyone signed in, everyone inducted',
      body: 'Workers complete the induction online before they arrive, then sign in by scanning a QR code at the gate. The register is ready if you are audited.',
      bullets: [
        { text: 'Online inductions, completed before the first day' },
        { text: 'QR sign-in and sign-out, with timesheets from the same records' },
        { text: 'Records kept for the periods the law requires' },
      ],
    },
    {
      blockType: 'roleSection',
      kicker: 'For subcontractors',
      heading: 'Free, always',
      body: 'Answer RFIs, respond to submittals and keep your compliance wallet current. There is no fee to work with your builder, and you only see what is shared with you.',
    },
    {
      blockType: 'roleSection',
      kicker: 'For clients and owners',
      heading: 'A clear, read-only window',
      body: 'Progress, variations and key documents in the owner portal, without chasing emails.',
      imagePath: '/home/10-defects.jpg',
      imageAlt: 'The defects list',
    },
    {
      blockType: 'timeline',
      heading: 'A day on Archova',
      steps: [
        { label: '6:30', body: 'The crew signs in by QR and the induction is checked.' },
        { label: '10:00', body: 'A defect is photographed and pinned to the drawing.' },
        { label: '1:00', body: 'An RFI goes out and the engineer replies from their phone.' },
        { label: '4:30', body: 'The diary closes with who was on site, the weather and photos.' },
      ],
    },
    {
      blockType: 'featureGrid',
      heading: 'What is inside',
      items: [
        {
          title: 'Drawings and documents',
          body: 'Registers, revisions, markups and transmittals.',
        },
        {
          title: 'RFIs and submittals',
          body: 'Raise, route and close, with due dates and links to the drawing.',
        },
        { title: 'Site diary', body: 'A daily record that fills in who was on site.' },
        {
          title: 'Defects and inspections',
          body: 'Photo, pin, assign, close out, and keep the checklist.',
        },
        {
          title: 'Inductions and sign-in',
          body: 'Online inductions and QR sign-in, with timesheets.',
        },
        { title: 'Programme', body: 'A schedule with baseline, and drag to reschedule.' },
        {
          title: 'Variations and claims',
          body: 'Security of Payment claims with the evidence kept together.',
        },
        { title: 'Budget and cost', body: 'Commitments, change orders and forecasting.' },
        {
          title: 'Tendering and estimating',
          body: 'Invite subcontractors by link, compare quotes, take off from drawings.',
        },
        { title: 'Meetings and correspondence', body: 'Minutes, actions and a searchable record.' },
        { title: 'Owner portal', body: 'A read-only view for clients.' },
        { title: 'Ask Nova', body: 'AI help in every module. It runs only in Australia.' },
      ],
    },
    {
      blockType: 'chips',
      items: [
        { label: 'Hosted in Australia' },
        { label: 'Audit log on every record' },
        { label: 'Works offline' },
        { label: 'Free for subcontractors' },
        { label: 'Xero and MYOB' },
        { label: 'Public API and webhooks' },
      ],
    },
    {
      blockType: 'cta',
      heading: 'Let us show you on a project like yours',
      body: 'Book a short walk-through. No obligation.',
      label: 'Request a demo',
      href: '/demo',
    },
  ],
};
// The home page is refreshed on every run so the starter content stays current; other pages are only added when missing.
{
  const found = await payload.find({
    collection: 'pages',
    where: { slug: { equals: 'home' } },
    limit: 1,
    draft: true,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- seed data is checked at runtime by Payload
  const data = { slug: 'home', _status: 'published', ...homeData } as any;
  if (found.docs[0]) await payload.update({ collection: 'pages', id: found.docs[0].id, data });
  else await payload.create({ collection: 'pages', data });
}

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
