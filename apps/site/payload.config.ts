import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sqliteAdapter } from '@payloadcms/db-sqlite';
import { lexicalEditor } from '@payloadcms/richtext-lexical';
import { buildConfig } from 'payload';
import sharp from 'sharp';
import { HelpArticles } from './src/collections/HelpArticles';
import { Inquiries } from './src/collections/Inquiries';
import { Media } from './src/collections/Media';
import { Pages } from './src/collections/Pages';
import { Posts } from './src/collections/Posts';
import { Users } from './src/collections/Users';
import { SiteSettings } from './src/globals/SiteSettings';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';
// `next build` loads this file without serving anything, so it gets a placeholder; a running production server still needs a real one.
const isBuild = process.env.NEXT_PHASE === 'phase-production-build';

// The CMS signs sessions with this. A fixed value is fine on one computer; any hosted site must set its own.
const secret =
  process.env.SITE_PAYLOAD_SECRET ??
  (isProd && !isBuild ? undefined : 'archova-local-site-secret-change-me');
if (!secret) throw new Error('SITE_PAYLOAD_SECRET is required in production.');

export default buildConfig({
  secret,
  serverURL: process.env.SITE_ORIGIN ?? 'http://localhost:3100',
  routes: { admin: '/cms' },
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: dirname,
      importMapFile: path.resolve(dirname, 'app/(payload)/cms/importMap.js'),
    },
    meta: { titleSuffix: ' · Archova CMS' },
  },
  collections: [Pages, Posts, HelpArticles, Media, Inquiries, Users],
  globals: [SiteSettings],
  editor: lexicalEditor(),
  // Local run keeps everything in one file under data/. The hosted site swaps this for the small Postgres adapter (ADR-0008).
  db: sqliteAdapter({
    client: { url: process.env.SITE_DB_URL ?? `file:${path.resolve(dirname, 'data/site.db')}` },
  }),
  sharp,
  // Scheduled posts publish at their set time through the job queue, with nobody signed in (WEB-AC9).
  jobs: { autoRun: [{ cron: '* * * * *', limit: 10 }] },
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
});
