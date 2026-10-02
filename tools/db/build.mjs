// Bundles the migration runner and the db-roles task for the migrate image (infrastructure/03 §5). The runner finds
// db/migrations two directories above itself, so the image puts the bundles in /app/tools/db/ next to
// /app/db/migrations.
import { build } from 'esbuild';

await build({
  entryPoints: ['db/migrate.ts', 'db/roles.ts'],
  outdir: 'db/dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: ['pg-native'],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'warning',
});
