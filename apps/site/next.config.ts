import path from 'node:path';
import type { NextConfig } from 'next';
import { withPayload } from '@payloadcms/next/withPayload';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  poweredByHeader: false,
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  transpilePackages: ['@archova/design-tokens', '@archova/ui'],
};

export default withPayload(nextConfig, { devBundleServerPackages: false });
