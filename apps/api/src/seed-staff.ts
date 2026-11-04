// pnpm --filter @archova/api staff:seed: creates or updates one staff account for the owner console.
// Env: API_DATABASE_URL, STAFF_EMAIL, STAFF_NAME, STAFF_PASSWORD (12+ characters), STAFF_ROLES (default "owner").
// Accounts have no sign-up route on purpose: staff are created here, and hosted staff come from the staff IdP.
import { STAFF_ROLES, type StaffRole } from '@archova/contracts';
import { createDatabase, createLogger } from '@archova/kernel';
import { createBackofficeModule } from '@archova/mod-backoffice';
import { createBillingModule } from '@archova/mod-billing';

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

const roles = (process.env.STAFF_ROLES ?? 'owner').split(',').map((r) => r.trim()) as StaffRole[];
for (const r of roles)
  if (!STAFF_ROLES.includes(r))
    throw new Error(`Unknown role ${r}. Roles: ${STAFF_ROLES.join(', ')}`);
const password = need('STAFF_PASSWORD');
if (password.length < 12) throw new Error('STAFF_PASSWORD needs at least 12 characters');

const database = createDatabase(need('API_DATABASE_URL'), { max: 2 });
const services = { database, redis: null, logger: createLogger('staff-seed', 'warn') };
const billing = createBillingModule(services);
const backoffice = createBackofficeModule(services, {
  catalogue: billing.api.catalogue,
  accounts: billing.api.accounts,
  adjustments: billing.api.adjustments,
  credits: () => {
    throw new Error('Granting credits is not available from the seed command');
  },
  supportReads: () => {
    throw new Error('The seed command does not read customer data');
  },
  notifySupportSession: () => {
    throw new Error('The seed command does not open support sessions');
  },
  config: { localLogin: true, soloCoolingOffHours: 24 },
});
const id = await backoffice.api.upsertLocalStaff({
  email: need('STAFF_EMAIL'),
  name: process.env.STAFF_NAME ?? 'Staff',
  password,
  roles,
});
// eslint-disable-next-line no-console -- a command-line tool reports to the terminal
console.log(`Staff account ${process.env.STAFF_EMAIL} ready (${roles.join(', ')}), id ${id}`);
await database.close();
