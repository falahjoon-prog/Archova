import type { CollectionConfig } from 'payload';
import { isStaff, onlyEditorsPublish, publishedOrStaff, slugFromTitle } from '../lib/access';
import { seoFields } from '../lib/seoFields';

const categories = [
  { label: 'Product', value: 'product' },
  { label: 'Construction', value: 'construction' },
  { label: 'Compliance', value: 'compliance' },
  { label: 'Company', value: 'company' },
];

/** Blog posts and case studies (WEB-AC9). Scheduled posts publish at the set time without anyone online. */
export const Posts: CollectionConfig = {
  slug: 'posts',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'kind', 'category', '_status', 'publishedAt'],
  },
  access: { read: publishedOrStaff, create: isStaff, update: isStaff, delete: isStaff },
  hooks: { beforeChange: [onlyEditorsPublish] },
  versions: { maxPerDoc: 50, drafts: { schedulePublish: true } },
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
      name: 'kind',
      type: 'select',
      defaultValue: 'blog',
      required: true,
      options: ['blog', 'caseStudy'],
    },
    { name: 'excerpt', type: 'textarea', required: true, maxLength: 300 },
    { name: 'author', type: 'relationship', relationTo: 'users', required: true },
    { name: 'heroImage', type: 'upload', relationTo: 'media' },
    { name: 'category', type: 'select', options: categories },
    { name: 'tags', type: 'text', hasMany: true },
    { name: 'publishedAt', type: 'date', admin: { date: { pickerAppearance: 'dayAndTime' } } },
    { name: 'body', type: 'richText', required: true },
    seoFields,
  ],
};
