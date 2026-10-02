import type { MetadataRoute } from 'next';
import { brand } from '@archova/design-tokens';

// Web app manifest with the Keystone app icon (brand/archova-logo, chosen 2 Oct 2026).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Archova',
    short_name: 'Archova',
    description: 'Construction project management for Australian builders.',
    start_url: '/',
    display: 'standalone',
    background_color: '#FFFFFF',
    theme_color: brand.blue,
    icons: [
      { src: '/brand/app-icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/app-icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
