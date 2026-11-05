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
   * App-wide security headers. Inline scripts and styles stay because Next emits them (no per-request nonce yet);
   * everything else is limited to our own origin. Uploads and downloads go to presigned object-store URLs, so
   * `connect-src` and `img-src` allow https; nothing can frame the app or load plugins.
   *
   * Guest pages (`/i/*` inductions and `/t/*` transmittals, X45, Sam's review) hold a worker's name, mobile number
   * and ticket photos, or a link's files, so they also send no referrer: the link token must not leak to anything
   * the page links to (Sam 11 §3). Their rule comes last so it wins on the shared header.
   */
  async headers() {
    // `wasm-unsafe-eval` lets the IFC reader (WebAssembly) start; it does not allow eval of text.
    const scriptSrc = isDev
      ? "'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'"
      : "'self' 'unsafe-inline' 'wasm-unsafe-eval'";
    const connectSrc = isDev
      ? "'self' https: http://localhost:* ws://localhost:*"
      : "'self' https:";
    const csp = [
      "default-src 'self'",
      `script-src ${scriptSrc}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      `connect-src ${connectSrc}`,
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ');
    const appWide = [
      { key: 'Content-Security-Policy', value: csp },
      // For browsers that ignore `frame-ancestors`.
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      // Mobile web uses the camera (photos, QR) and location (sign-in); nothing else is needed.
      {
        key: 'Permissions-Policy',
        value: 'camera=(self), microphone=(), geolocation=(self), payment=(), usb=()',
      },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    ];
    const guest = [{ key: 'Referrer-Policy', value: 'no-referrer' }];
    return [
      { source: '/:path*', headers: appWide },
      { source: '/i/:path*', headers: guest },
      { source: '/t/:path*', headers: guest },
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
