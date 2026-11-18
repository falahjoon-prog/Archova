import type { Block } from 'payload';

// Typed blocks, no raw HTML or script blocks (frontend/10 §3).
export const blocks: Block[] = [
  {
    slug: 'hero',
    interfaceName: 'HeroBlock',
    fields: [
      { name: 'heading', type: 'text', required: true },
      { name: 'subheading', type: 'textarea' },
      { name: 'primaryLabel', type: 'text' },
      { name: 'primaryHref', type: 'text' },
      { name: 'secondaryLabel', type: 'text' },
      { name: 'secondaryHref', type: 'text' },
    ],
  },
  {
    slug: 'featureGrid',
    interfaceName: 'FeatureGridBlock',
    fields: [
      { name: 'heading', type: 'text' },
      {
        name: 'items',
        type: 'array',
        minRows: 1,
        fields: [
          { name: 'title', type: 'text', required: true },
          { name: 'body', type: 'textarea', required: true },
        ],
      },
    ],
  },
  {
    slug: 'richText',
    interfaceName: 'RichTextBlock',
    fields: [{ name: 'content', type: 'richText', required: true }],
  },
  {
    slug: 'faq',
    interfaceName: 'FaqBlock',
    fields: [
      { name: 'heading', type: 'text' },
      {
        name: 'items',
        type: 'array',
        minRows: 1,
        fields: [
          { name: 'question', type: 'text', required: true },
          { name: 'answer', type: 'textarea', required: true },
        ],
      },
    ],
  },
  {
    slug: 'cta',
    interfaceName: 'CtaBlock',
    fields: [
      { name: 'heading', type: 'text', required: true },
      { name: 'body', type: 'textarea' },
      { name: 'label', type: 'text', required: true },
      { name: 'href', type: 'text', required: true },
    ],
  },
  // Image-and-text section for one audience ("For site teams"). Images are files under public/, never raw HTML.
  {
    slug: 'roleSection',
    interfaceName: 'RoleSectionBlock',
    fields: [
      { name: 'kicker', type: 'text' },
      { name: 'heading', type: 'text', required: true },
      { name: 'body', type: 'textarea' },
      { name: 'bullets', type: 'array', fields: [{ name: 'text', type: 'text', required: true }] },
      {
        name: 'imagePath',
        type: 'text',
        admin: { description: 'A file under public/, for example /home/site-diary.jpg' },
      },
      { name: 'imageAlt', type: 'text' },
    ],
  },
  // A short run of dated or numbered steps ("A day on Archova").
  {
    slug: 'timeline',
    interfaceName: 'TimelineBlock',
    fields: [
      { name: 'heading', type: 'text', required: true },
      {
        name: 'steps',
        type: 'array',
        minRows: 1,
        fields: [
          { name: 'label', type: 'text', required: true },
          { name: 'body', type: 'textarea', required: true },
        ],
      },
    ],
  },
  // A row of short labels: module names, or capability callouts.
  {
    slug: 'chips',
    interfaceName: 'ChipsBlock',
    fields: [
      { name: 'heading', type: 'text' },
      {
        name: 'items',
        type: 'array',
        minRows: 1,
        fields: [{ name: 'label', type: 'text', required: true }],
      },
    ],
  },
  // Prices are never typed here: the block reads the price book (WEB-AC6).
  {
    slug: 'pricingTable',
    interfaceName: 'PricingTableBlock',
    fields: [{ name: 'note', type: 'textarea' }],
  },
];
