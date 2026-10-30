import path from 'node:path';
import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV === 'development';
const apiInternalUrl = process.env.WEB_API_INTERNAL_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Self-contained server for the production image (Dockerfile, infrastructure/01 §5).
  output: 'standalone',
  poweredByHeader: false,
  // The monorepo root (scripts run with cwd apps/web), so output tracing doesn't guess from stray lockfiles.
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  // Workspace packages export TypeScript source.
  transpilePackages: [
    '@archova/api-client',
    '@archova/auth-client',
    '@archova/contracts',
    '@archova/design-tokens',
    '@archova/domain',
    '@archova/i18n',
    '@archova/markup',
    '@archova/query',
    '@archova/routes',
    '@archova/time',
    '@archova/ui',
  ],
  // Lint runs as its own turbo task (`pnpm --filter @archova/web lint`).
  eslint: { ignoreDuringBuilds: true },
  /**
   * ADR-0004: in deployed environments CloudFront/ALB routes `/v1/*` on the app origin straight to apps/api, so
   * the browser is same-origin with the API. Locally the Next dev server stands in for that path rule.
   * The proxy forwards `X-Forwarded-Host: localhost:3000`, which the API trusts with API_TRUST_PROXY=true.
   */
  /**
   * Guest pages (`/i/*` inductions and `/t/*` transmittals, X45, Sam's review) run only our own scripts: nothing
   * from another origin can run on a page that holds a worker's name, mobile number and ticket photos, or a link's
   * files. Inline scripts stay because Next
   * emits them; the rest of the policy is left to the app-wide one.
   */
  async headers() {
    const scriptSrc = isDev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self' 'unsafe-inline'";
    const headers = [
      {
        key: 'Content-Security-Policy',
        value: `script-src ${scriptSrc}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`,
      },
    ];
    return [
      { source: '/i/:path*', headers },
      { source: '/t/:path*', headers },
    ];
  },
  async rewrites() {
    if (!isDev) return [];
    return [
      { source: '/v1/:path*', destination: `${apiInternalUrl}/v1/:path*` },
      { source: '/.well-known/:path*', destination: `${apiInternalUrl}/.well-known/:path*` },
    ];
  },
};

export default nextConfig;
