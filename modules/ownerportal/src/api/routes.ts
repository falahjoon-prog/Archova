import type { ProblemCode } from '@archova/contracts';
import { decodeId, encodeId, type IdKind } from '@archova/domain';
import {
  ACCESS_LINK_SESSION_MS,
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
import { PORTAL_LINK_COOKIE, type ShareService } from '../application/share';

const LINK_HEADERS = {
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
  'cache-control': 'no-store',
};

const id = (kind: IdKind, value: string, code: ProblemCode) => {
  const uuid = decodeId(kind, value);
  if (!uuid) throw new AppError(code);
  return uuid;
};
const project = (p: { projectId: string }) => id('project', p.projectId, 'project.not_found');

export function ownerPortalRoutes(
  database: Database,
  svc: OwnerPortalService,
  share: ShareService,
) {
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

  const facts = (input: { ip: string; userAgent: string | null; requestId: string }) => ({
    ip: input.ip,
    userAgent: input.userAgent,
    requestId: input.requestId,
  });

  return defineRoutes({
    listOwnerShareLinks: async (input) => ({
      status: 200,
      body: await read(input, (s) => share.listLinks(s, project(input.params))),
    }),
    createOwnerShareLink: async (input) => {
      const p = project(input.params);
      const issued = await tx(input, (s) => share.issue(s, p, input.body));
      // Emailed after the link is saved, so a failed send leaves a link the builder can still copy.
      const emailed = await tx(input, (s) => share.deliver(s, p, issued));
      const [row] = (await read(input, (s) => share.listLinks(s, p))).data.filter(
        (l) => l.id === encodeId('accessLink', issued.link.id),
      );
      return { status: 201, body: { link: row!, url: issued.url, emailed } };
    },
    revokeOwnerShareLink: async (input) => ({
      status: 200,
      body: await tx(input, (s) =>
        share.revoke(
          s,
          project(input.params),
          id('accessLink', input.params.linkId, 'access_link.not_found'),
        ),
      ),
    }),
    listOwnerSharedPhotos: async (input) => ({
      status: 200,
      body: await read(input, (s) => share.listPhotos(s, project(input.params))),
    }),
    addOwnerSharedPhoto: async (input) => ({
      status: 200,
      body: await tx(input, (s) => share.addPhoto(s, project(input.params), input.body)),
    }),
    removeOwnerSharedPhoto: async (input) => ({
      status: 200,
      body: await tx(input, (s) =>
        share.removePhoto(s, project(input.params), input.params.fileId),
      ),
    }),
    openOwnerPortalAccess: async (input) => {
      const r = await share.open(input.body.token, facts(input));
      return {
        status: 200,
        body: r.body,
        headers: LINK_HEADERS,
        setCookies: [
          {
            name: PORTAL_LINK_COOKIE,
            value: r.cookie,
            httpOnly: true,
            maxAgeSeconds: Math.floor(ACCESS_LINK_SESSION_MS / 1000),
          },
        ],
      };
    },
    getOwnerPortalAccess: async (input) => ({
      status: 200,
      body: await share.view(input.cookies[PORTAL_LINK_COOKIE], facts(input)),
      headers: LINK_HEADERS,
    }),
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
