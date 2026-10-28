// pnpm admin:local: runs the owner console on your own computer. Needs Postgres (docker compose up -d postgres).
// Prepares the database, creates two sample staff accounts, then starts the API (port 4000) and the console (3200).
// Local only: the passwords below are public and the cooling-off for solo owners is switched off.
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';

const DB_HOST = process.env.DB_HOST ?? 'localhost';
const DB_PORT = Number(process.env.DB_PORT ?? 5432);
const shell = process.platform === 'win32';
const env = {
  ...process.env,
  DB_ADMIN_URL:
    process.env.DB_ADMIN_URL ?? `postgres://postgres:postgres@${DB_HOST}:${DB_PORT}/postgres`,
  API_DATABASE_URL: `postgres://app_rw:app_rw@${DB_HOST}:${DB_PORT}/archova`,
  API_STAFF_SOLO_COOLING_OFF_HOURS: '0',
};

const up = await new Promise((resolve) => {
  const s = net.connect(DB_PORT, DB_HOST);
  s.once('connect', () => (s.destroy(), resolve(true)));
  s.once('error', () => resolve(false));
});
if (!up) {
  console.error(
    `\nNo database on ${DB_HOST}:${DB_PORT}. Start it first, then run this again:\n\n  docker compose up -d postgres\n`,
  );
  process.exit(1);
}

const run = (label, args, extra = {}) => {
  console.log(`\n> ${label}`);
  const r = spawnSync('pnpm', args, { stdio: 'inherit', shell, env: { ...env, ...extra } });
  if (r.status !== 0) {
    console.error(`\n"${label}" failed. See the messages above.`);
    process.exit(r.status ?? 1);
  }
};

run('Preparing the database', ['db:bootstrap']);
run('Applying migrations', ['db:migrate']);
const seed = (email, name, roles) =>
  run(`Staff account ${email}`, ['--filter', '@archova/api', 'staff:seed'], {
    STAFF_EMAIL: email,
    STAFF_NAME: name,
    STAFF_PASSWORD: 'Archova-Local-1',
    STAFF_ROLES: roles,
  });
seed('owner@archova.local', 'Local Owner', 'owner');
seed('approver@archova.local', 'Pat Approver', 'pricing_approver');

console.log(
  '\nStarting the API and the console. Open http://localhost:3200 once both say "ready".\n',
);
const children = [
  spawn('pnpm', ['--filter', '@archova/api', 'dev'], { stdio: 'inherit', shell, env }),
  spawn('pnpm', ['--filter', '@archova/admin', 'dev'], { stdio: 'inherit', shell, env }),
];
const stop = () => children.forEach((c) => c.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children.forEach((c) => c.on('exit', (code) => code && stop()));
