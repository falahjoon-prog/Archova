import type { PermissionDefinition } from '@archova/domain/permissions';
import type { Database } from './db';
import type { Logger } from './logger';
import type { RedisClient } from './redis';

/**
 * Services every module can receive. Modules never construct their own connections.
 * `TRoutes` is the HTTP app type (Fastify) — kept generic so the kernel stays framework-free.
 */
export interface KernelServices {
  database: Database;
  redis: RedisClient | null;
  logger: Logger;
}

export interface ModuleDefinition<TApp = unknown, TDeps = unknown> {
  /** Module name = Postgres schema name = permission key prefix. */
  name: string;
  /** Global modules (identity) live in the cell's global layer and have no tenant tables. */
  global?: boolean;
  permissions?: readonly PermissionDefinition[];
  /** Registers HTTP handlers bound to OpenAPI operationIds. */
  routes?: (app: TApp, deps: TDeps) => void | Promise<void>;
}

/** Single registration point for a module (backend 01 §2). */
export function defineModule<TApp, TDeps>(
  def: ModuleDefinition<TApp, TDeps>,
): ModuleDefinition<TApp, TDeps> {
  if (!/^[a-z][a-z_]*$/.test(def.name)) throw new Error(`Invalid module name ${def.name}`);
  return def;
}
