import type { CollectionConfig } from 'payload';
import { isStaff } from '../lib/access';

export const Media: CollectionConfig = {
  slug: 'media',
  access: { read: () => true, create: isStaff, update: isStaff, delete: isStaff },
  upload: {
    staticDir: 'data/media',
    mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'],
    imageSizes: [
      { name: 'card', width: 640 },
      { name: 'hero', width: 1600 },
    ],
  },
  // Alt text is required: the pre-publish accessibility checks (design B4) start here.
  fields: [{ name: 'alt', type: 'text', required: true }],
};
