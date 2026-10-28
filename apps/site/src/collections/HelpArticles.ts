import type { CollectionConfig } from 'payload';
import { isStaff, onlyEditorsPublish, publishedOrStaff, slugFromTitle } from '../lib/access';
import { seoFields } from '../lib/seoFields';

export const HelpArticles: CollectionConfig = {
  slug: 'help-articles',
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'module', '_status'] },
  access: { read: publishedOrStaff, create: isStaff, update: isStaff, delete: isStaff },
  hooks: { beforeChange: [onlyEditorsPublish] },
  versions: { maxPerDoc: 25, drafts: true },
  fields: [
    { name: 'title', type: 'text', required: true },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      hooks: { beforeValidate: [slugFromTitle] },
    },
    {
      name: 'module',
      type: 'select',
      required: true,
      options: [
        'getting-started',
        'documents',
        'rfis',
        'site-diary',
        'workforce',
        'nova',
        'billing',
      ],
    },
    { name: 'summary', type: 'textarea', required: true, maxLength: 300 },
    { name: 'body', type: 'richText', required: true },
    seoFields,
  ],
};
