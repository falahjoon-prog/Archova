import { decodeId, type IdKind } from '@archova/domain';
import type { ProblemCode } from '@archova/contracts';
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
import { captureDto, type BimService } from '../application/bim';

const id = (kind: IdKind, value: string, code: ProblemCode) => {
  const uuid = decodeId(kind, value);
  if (!uuid) throw new AppError(code);
  return uuid;
};
const project = (p: { projectId: string }) => id('project', p.projectId, 'project.not_found');
const issueId = (p: { issueId: string }) =>
  id('coordinationIssue', p.issueId, 'bim.issue_not_found');

const captureId = (p: { captureId: string }) =>
  id('siteCapture', p.captureId, 'bim.capture_not_found');

export function bimRoutes(database: Database, svc: BimService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const ok = (status: number, d: Awaited<ReturnType<BimService['getIssue']>>) => ({
    status,
    body: { issue: d.issue, comments: d.comments },
    headers: { etag: etag(d.version) },
  });

  return defineRoutes({
    listBimModels: async (input) => ({
      status: 200,
      body: await read(input, (s) => svc.listModels(s, project(input.params))),
    }),
    createBimModel: async (input) => ({
      status: 201,
      body: await tx(input, (s) => svc.createModel(s, project(input.params), input.body)),
    }),
    listCoordinationIssues: async (input) => {
      const q = input.query;
      return {
        status: 200,
        body: await read(input, (s) =>
          svc.listIssues(s, project(input.params), {
            ...(q.status ? { status: q.status } : {}),
            ...(q.modelId ? { modelId: q.modelId } : {}),
            ...(q.q ? { q: q.q } : {}),
          }),
        ),
      };
    },
    createCoordinationIssue: async (input) =>
      ok(201, await tx(input, (s) => svc.createIssue(s, project(input.params), input.body))),
    getCoordinationIssue: async (input) =>
      ok(
        200,
        await read(input, (s) => svc.getIssue(s, project(input.params), issueId(input.params))),
      ),
    updateCoordinationIssue: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return ok(
        200,
        await tx(input, (s) =>
          svc.updateIssue(s, project(input.params), issueId(input.params), expected, input.body),
        ),
      );
    },
    addCoordinationIssueComment: async (input) =>
      ok(
        201,
        await tx(input, (s) =>
          svc.addComment(s, project(input.params), issueId(input.params), input.body),
        ),
      ),
    listSiteCaptures: async (input) => ({
      status: 200,
      body: await read(input, (s) => svc.listCaptures(s, project(input.params))),
    }),
    createSiteCapture: async (input) => {
      const row = await tx(input, (s) => svc.createCapture(s, project(input.params), input.body));
      return { status: 201, body: captureDto(row), headers: { etag: etag(row.version) } };
    },
    updateSiteCapture: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const row = await tx(input, (s) =>
        svc.updateCapture(s, project(input.params), captureId(input.params), expected, input.body),
      );
      return { status: 200, body: captureDto(row), headers: { etag: etag(row.version) } };
    },
    deleteSiteCapture: async (input) => {
      await tx(input, (s) => svc.deleteCapture(s, project(input.params), captureId(input.params)));
      return { status: 204 };
    },
  });
}
