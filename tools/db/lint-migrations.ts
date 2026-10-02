// pnpm db:lint — static migration checks, then catalog checks against the migrated database.
import { lintMigrationFiles } from './static-lint';
import { lintSchema } from './rls-lint';
import { migratorUrl } from './env';

const staticProblems = lintMigrationFiles();
const catalogProblems = process.argv.includes('--static-only')
  ? []
  : await lintSchema(migratorUrl());
const all = [...staticProblems, ...catalogProblems];
if (all.length) {
  console.error(`Migration lint failed:\n${all.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('Migration lint passed.');
