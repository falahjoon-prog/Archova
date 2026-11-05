import type { ProblemCode } from '@archova/contracts';
import { decodeId, type IdKind } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  etag,
  parseIfMatch,
  requireTenant,
  type Database,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { OwnerPortalService } from '../application/ownerportal';

const id = (kind: IdKind, value: string, code: ProblemCode) => {
  const uuid = decodeId(kind, value);
  if (!uuid) throw new AppError(code);
  return uuid;
};
const project = (p: { projectId: string }) => id('project', p.projectId, 'project.not_found');

export function ownerPortalRoutes(database: Database, svc: OwnerPortalService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const versioned = <T extends { version: number }>(status: number, body: T) => ({
    status,
    body,
    headers: { etag: etag(body.version) },
  });
  const updateId = (p: { updateId: string }) =>
    id('ownerProgressUpdate', p.updateId, 'ownerportal.update_not_found');
  const approvalId = (p: { approvalId: string }) =>
    id('ownerApproval', p.approvalId, 'ownerportal.approval_not_found');
  const itemId = (p: { itemId: string }) =>
    id('ownerCapitalItem', p.itemId, 'ownerportal.item_not_found');

  return defineRoutes({
    listOwnerProgressUpdates: async (input) => ({
      status: 200,
      body: await read(input, (s) => svc.listUpdates(s, project(input.params))),
    }),
    createOwnerProgressUpdate: async (input) =>
      versioned(
        201,
        await tx(input, (s) => svc.createUpdate(s, project(input.params), input.body)),
      ),
    updateOwnerProgressUpdate: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return versioned(
        200,
        await tx(input, (s) =>
          svc.updateUpdate(s, project(input.params), updateId(input.params), expected, input.body),
        ),
      );
    },
    publishOwnerProgressUpdate: async (input) =>
      versioned(
        200,
        await tx(input, (s) => svc.publishUpdate(s, project(input.params), updateId(input.params))),
      ),
    listOwnerApprovals: async (input) => ({
      status: 200,
      body: await read(input, (s) => svc.listApprovals(s, project(input.params))),
    }),
    createOwnerApproval: async (input) =>
      versioned(
        201,
        await tx(input, (s) => svc.createApproval(s, project(input.params), input.body)),
      ),
    decideOwnerApproval: async (input) =>
      versioned(
        200,
        await tx(input, (s) =>
          svc.decide(s, project(input.params), approvalId(input.params), input.body),
        ),
      ),
    withdrawOwnerApproval: async (input) =>
      versioned(
        200,
        await tx(input, (s) => svc.withdraw(s, project(input.params), approvalId(input.params))),
      ),
    getOwnerCapitalPlan: async (input) => ({
      status: 200,
      body: await read(input, (s) => svc.plan(s, project(input.params))),
    }),
    createOwnerCapitalItem: async (input) =>
      versioned(201, await tx(input, (s) => svc.createItem(s, project(input.params), input.body))),
    updateOwnerCapitalItem: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return versioned(
        200,
        await tx(input, (s) =>
          svc.updateItem(s, project(input.params), itemId(input.params), expected, input.body),
        ),
      );
    },
    deleteOwnerCapitalItem: async (input) => {
      await tx(input, (s) => svc.removeItem(s, project(input.params), itemId(input.params)));
      return { status: 204 };
    },
  });
}
