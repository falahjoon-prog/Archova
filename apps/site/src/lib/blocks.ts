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
  // Prices are never typed here: the block reads the price book (WEB-AC6).
  {
    slug: 'pricingTable',
    interfaceName: 'PricingTableBlock',
    fields: [{ name: 'note', type: 'textarea' }],
  },
];
