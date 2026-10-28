import type { CollectionConfig } from 'payload';
import { onlyEditorsPublish, publishedOrStaff, slugFromTitle, isStaff } from '../lib/access';
import { blocks } from '../lib/blocks';
import { seoFields } from '../lib/seoFields';

export const Pages: CollectionConfig = {
  slug: 'pages',
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'slug', '_status', 'updatedAt'] },
  access: { read: publishedOrStaff, create: isStaff, update: isStaff, delete: isStaff },
  hooks: { beforeChange: [onlyEditorsPublish] },
  versions: { maxPerDoc: 50, drafts: { schedulePublish: true } },
  fields: [
    { name: 'title', type: 'text', required: true },
    // "home" is the front page; every other slug is served at /<slug>.
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      hooks: { beforeValidate: [slugFromTitle] },
    },
    { name: 'layout', type: 'blocks', blocks, required: true, minRows: 1 },
    seoFields,
  ],
};
