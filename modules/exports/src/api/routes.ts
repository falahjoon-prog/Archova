import { decodeId } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  requirePrincipal,
  requireTenant,
  type Database,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { ExportsService } from '../application/exports';

/** Starting or downloading an export needs a sign-in from the last 15 minutes: it gathers every record. */
const STEP_UP_MS = 15 * 60_000;

export function exportsRoutes(database: Database, service: ExportsService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const id = (p: { exportId: string }) => {
    const v = decodeId('dataExport', p.exportId);
    if (!v) throw new AppError('data_export.not_found');
    return v;
  };
  // Tokens and other machine credentials never start or fetch a full export: a person signed in to the app does.
  const person = (
    input: Parameters<typeof requireTenant>[0] & Parameters<typeof requirePrincipal>[0],
  ) => {
    const p = requirePrincipal(input);
    if (p.apiToken || requireTenant(input).principalType !== 'member')
      throw new AppError('access.denied', 'Sign in to Archova to export your data.');
    return p;
  };

  const stepUp = (p: { authTime: Date }) => {
    if (Date.now() - p.authTime.getTime() > STEP_UP_MS)
      throw new AppError('auth.step_up_required', 'Sign in again to export your data.');
  };

  return defineRoutes({
    listDataExports: async (input) => {
      person(input);
      return { status: 200, body: await read(input, (s) => service.list(s)) };
    },
    createDataExport: async (input) => {
      stepUp(person(input));
      return { status: 202, body: await tx(input, (s) => service.create(s, input.ip)) };
    },
    getDataExport: async (input) => {
      person(input);
      return { status: 200, body: await read(input, (s) => service.get(s, id(input.params))) };
    },
    createDataExportDownload: async (input) => {
      stepUp(person(input));
      return {
        status: 200,
        body: await tx(input, (s) => service.download(s, id(input.params), input.ip)),
        headers: { 'cache-control': 'no-store' },
      };
    },
  });
}
