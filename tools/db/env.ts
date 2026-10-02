// Local/CI database settings. Production roles and passwords are managed by infra (Owen), never by these scripts.
export const DB_NAME = process.env.DB_NAME ?? 'archova';
export const DB_HOST = process.env.DB_HOST ?? 'localhost';
export const DB_PORT = process.env.DB_PORT ?? '5432';

export const adminUrl = () =>
  process.env.DB_ADMIN_URL ?? `postgres://postgres:postgres@${DB_HOST}:${DB_PORT}/postgres`;

export const migratorUrl = (db = DB_NAME) =>
  process.env.MIGRATOR_DATABASE_URL ??
  `postgres://app_migrator:app_migrator@${DB_HOST}:${DB_PORT}/${db}`;

export const appUrl = (db = DB_NAME) => `postgres://app_rw:app_rw@${DB_HOST}:${DB_PORT}/${db}`;
