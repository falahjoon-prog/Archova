// Bundles the migration runner for the migrate image (infrastructure/03 §5). The runner finds db/migrations two
// directories above itself, so the image puts the bundle at /app/tools/db/migrate.js next to /app/db/migrations.
import { build } from 'esbuild';

await build({
  entryPoints: ['db/migrate.ts'],
  outfile: 'db/dist/migrate.js',
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
