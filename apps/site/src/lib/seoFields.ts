import type { Field } from 'payload';

export const seoFields: Field = {
  name: 'seo',
  type: 'group',
  fields: [
    { name: 'title', type: 'text', maxLength: 70 },
    { name: 'description', type: 'textarea', maxLength: 170 },
    { name: 'image', type: 'upload', relationTo: 'media' },
    { name: 'canonicalUrl', type: 'text' },
    { name: 'noindex', type: 'checkbox', defaultValue: false },
  ],
};
