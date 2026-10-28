import type { GlobalConfig } from 'payload';
import { isAdmin } from '../lib/access';

/** Menus, footer and contact details. Brand colours stay in @archova/design-tokens (X57, X64). */
export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  access: { read: () => true, update: isAdmin },
  fields: [
    {
      name: 'tagline',
      type: 'text',
      defaultValue: 'Construction project management for Australian builders.',
    },
    { name: 'salesEmail', type: 'email', defaultValue: 'hello@archova.com.au' },
    {
      name: 'headerLinks',
      type: 'array',
      fields: [
        { name: 'label', type: 'text', required: true },
        { name: 'href', type: 'text', required: true },
      ],
    },
    {
      name: 'footerLinks',
      type: 'array',
      fields: [
        { name: 'label', type: 'text', required: true },
        { name: 'href', type: 'text', required: true },
      ],
    },
    { name: 'defaultSeoDescription', type: 'textarea' },
  ],
};
