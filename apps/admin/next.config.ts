import path from 'node:path';
import type { NextConfig } from 'next';

// The console and its API share one origin in the browser: /internal/* is proxied to apps/api, like the load
// balancer does for console.<domain> in a deployed environment (backend 09 §1).
const apiInternalUrl = process.env.ADMIN_API_INTERNAL_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  poweredByHeader: false,
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  transpilePackages: [
    '@archova/contracts',
    '@archova/design-tokens',
    '@archova/time',
    '@archova/ui',
  ],
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ];
  },
  async rewrites() {
    return [{ source: '/internal/:path*', destination: `${apiInternalUrl}/internal/:path*` }];
  },
};

export default nextConfig;
