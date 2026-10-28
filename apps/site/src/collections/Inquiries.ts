import type { CollectionConfig } from 'payload';
import { isStaff } from '../lib/access';

/** Demo and contact requests (B6). Written only by the site's server action; read only by staff. */
export const Inquiries: CollectionConfig = {
  slug: 'inquiries',
  admin: { useAsTitle: 'email', defaultColumns: ['name', 'email', 'company', 'createdAt'] },
  access: { read: isStaff, create: () => false, update: isStaff, delete: isStaff },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'email', type: 'email', required: true },
    { name: 'company', type: 'text' },
    { name: 'phone', type: 'text' },
    { name: 'teamSize', type: 'text' },
    { name: 'message', type: 'textarea' },
    { name: 'consentGiven', type: 'checkbox', required: true },
  ],
};
