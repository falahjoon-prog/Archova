// pnpm db:bootstrap [--reset] [--db <name>]
import { bootstrapDatabase } from './bootstrap-lib';
import { DB_NAME, adminUrl } from './env';

const args = process.argv.slice(2);
const dbIdx = args.indexOf('--db');
const dbName = dbIdx >= 0 ? args[dbIdx + 1]! : DB_NAME;
await bootstrapDatabase(adminUrl(), dbName, { reset: args.includes('--reset') });
console.log(`Roles ready; database ${dbName} ready.`);
