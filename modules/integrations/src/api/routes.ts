import { decodeId } from '@archova/domain';
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
import type { ImportService } from '../application/imports';
import type { AccountingService } from '../application/accounting';
import type { WebhookService } from '../application/webhooks';
import { PUBLIC_EVENT_TYPES } from '../domain/webhooks/events';
import {
  toConnectionDto,
  toImportJobDto,
  toImportRowDto,
  toSyncIssueDto,
  toWebhookDeliveryDto,
  toWebhookDto,
} from './mappers';

const project = (p: { projectId: string }) => {
  const id = decodeId('project', p.projectId);
  if (!id) throw new AppError('project.not_found');
  return id;
};
const jobIdOf = (p: { importJobId: string }) => {
  const id = decodeId('importJob', p.importJobId);
  if (!id) throw new AppError('import.not_found');
  return id;
};

export function integrationsRoutes(
  database: Database,
  svc: ImportService,
  webhooks: WebhookService,
  accounting: AccountingService,
  available: readonly ('xero' | 'myob')[],
) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const job = (status: number, x: Awaited<ReturnType<ImportService['get']>>) => ({
    status,
    body: toImportJobDto(x),
    headers: { etag: etag(x.version) },
  });

  const webhookIdOf = (p: { webhookId: string }) => {
    const id = decodeId('webhook', p.webhookId);
    if (!id) throw new AppError('webhook.not_found');
    return id;
  };

  const issueIdOf = (p: { syncIssueId: string }) => {
    const id = decodeId('syncIssue', p.syncIssueId);
    if (!id) throw new AppError('sync_issue.not_found');
    return id;
  };

  return defineRoutes({
    listAccountingConnections: async (input) => {
      const rows = await read(input, (s) => accounting.list(s));
      return { status: 200, body: { data: rows.map(toConnectionDto), available: [...available] } };
    },
    startAccountingConnection: async (input) => {
      const t = requireTenant(input);
      const r = await tx(input, (s) => accounting.start(s, t.userId, input.params.provider));
      return { status: 200, body: r };
    },
    completeAccountingConnection: async (input) => {
      const { provider } = input.params;
      const { state, code } = input.body;
      // The provider calls run with no transaction open.
      const verifier = await read(input, (s) => accounting.prepareCallback(s, provider, state));
      let result;
      try {
        result = await accounting.exchange(provider, code, verifier);
      } catch (e) {
        await tx(input, (s) => accounting.abandonCallback(s, provider));
        throw e;
      }
      const { connection } = await tx(input, (s) =>
        accounting.finishCallback(s, provider, state, result),
      );
      return { status: 200, body: toConnectionDto(connection) };
    },
    listAccountingTargets: async (input) => {
      const data = await read(input, (s) => accounting.targets(s, input.params.provider));
      return { status: 200, body: { data } };
    },
    selectAccountingTarget: async (input) => {
      const { provider } = input.params;
      const available = await read(input, (s) => accounting.targets(s, provider));
      const row = await tx(input, (s) =>
        accounting.selectTarget(s, provider, input.body.ref, available),
      );
      return { status: 200, body: toConnectionDto(row) };
    },
    updateAccountingFieldMap: async (input) => {
      const row = await tx(input, (s) =>
        accounting.setFieldMap(s, input.params.provider, input.body),
      );
      return { status: 200, body: toConnectionDto(row) };
    },
    updateAccountingSettings: async (input) => {
      const row = await tx(input, (s) =>
        accounting.setSettings(s, input.params.provider, input.body),
      );
      return { status: 200, body: toConnectionDto(row) };
    },
    disconnectAccounting: async (input) => {
      await tx(input, (s) => accounting.disconnect(s, input.params.provider));
      return { status: 204 };
    },
    listAccountingSyncIssues: async (input) => {
      const { issues, providers } = await read(input, async (s) => ({
        issues: await accounting.issues(s),
        providers: new Map((await accounting.list(s)).map((c) => [c.id, c.provider] as const)),
      }));
      return {
        status: 200,
        body: {
          data: issues.flatMap((i) => {
            const p = providers.get(i.connectionId);
            return p ? [toSyncIssueDto(i, p)] : [];
          }),
        },
      };
    },
    resolveAccountingSyncIssue: async (input) => {
      const t = requireTenant(input);
      const { row, provider } = await tx(input, async (s) => {
        const row = await accounting.resolveIssue(s, t.userId, issueIdOf(input.params));
        const conn = (await accounting.list(s)).find((c) => c.id === row.connectionId);
        return { row, provider: conn!.provider };
      });
      return { status: 200, body: toSyncIssueDto(row, provider) };
    },
    listWebhooks: async (input) => {
      const rows = await read(input, (s) => webhooks.list(s));
      return {
        status: 200,
        body: { data: rows.map(toWebhookDto), availableEventTypes: [...PUBLIC_EVENT_TYPES] },
      };
    },
    createWebhook: async (input) => {
      const t = requireTenant(input);
      const projectIds = (input.body.projectIds ?? []).map((p) => {
        const id = decodeId('project', p);
        if (!id)
          throw new AppError('validation_failed', 'Invalid id', [
            { path: 'projectIds', message: 'Invalid id' },
          ]);
        return id;
      });
      const body = { ...input.body, projectIds };
      // The test call to the endpoint runs before any transaction opens.
      const { secret } = await webhooks.prepare(t.orgId, body);
      const row = await tx(input, (s) => webhooks.create(s, t.userId, body, secret));
      return { status: 201, body: { ...toWebhookDto(row), secret } };
    },
    deleteWebhook: async (input) => {
      await tx(input, (s) => webhooks.remove(s, webhookIdOf(input.params)));
      return { status: 204 };
    },
    listWebhookDeliveries: async (input) => {
      const rows = await read(input, (s) => webhooks.deliveries(s, webhookIdOf(input.params)));
      return { status: 200, body: { data: rows.map(toWebhookDeliveryDto) } };
    },
    listImportJobs: async (input) => {
      const page = await read(input, (s) =>
        svc.list(s, project(input.params), {
          limit: input.query.limit,
          ...(input.query.cursor ? { cursor: input.query.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toImportJobDto), nextCursor: page.nextCursor },
      };
    },
    createImportJob: async (input) => {
      const fileId = decodeId('file', input.body.fileId);
      if (!fileId)
        throw new AppError('validation_failed', 'Invalid id', [
          { path: 'fileId', message: 'Invalid id' },
        ]);
      return job(
        201,
        await tx(input, (s) =>
          svc.create(s, project(input.params), {
            entity: input.body.entity,
            source: input.body.source ?? 'spreadsheet',
            fileId,
            ...(input.body.headerRow ? { headerRow: input.body.headerRow } : {}),
          }),
        ),
      );
    },
    getImportJob: async (input) =>
      job(200, await read(input, (s) => svc.get(s, project(input.params), jobIdOf(input.params)))),
    parseImportJob: async (input) =>
      job(
        200,
        await tx(input, (s) =>
          svc.parse(
            s,
            project(input.params),
            jobIdOf(input.params),
            parseIfMatch(input.headers['if-match']),
          ),
        ),
      ),
    setImportMapping: async (input) =>
      job(
        200,
        await tx(input, (s) =>
          svc.setMapping(
            s,
            project(input.params),
            jobIdOf(input.params),
            parseIfMatch(input.headers['if-match']),
            input.body,
          ),
        ),
      ),
    cancelImportJob: async (input) =>
      job(
        200,
        await tx(input, (s) =>
          svc.cancel(
            s,
            project(input.params),
            jobIdOf(input.params),
            parseIfMatch(input.headers['if-match']),
          ),
        ),
      ),
    listImportRows: async (input) => {
      const page = await read(input, (s) =>
        svc.rows(s, project(input.params), jobIdOf(input.params), {
          ...(input.query.status ? { status: input.query.status } : {}),
          limit: input.query.limit,
          ...(input.query.cursor ? { cursor: input.query.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toImportRowDto), nextCursor: page.nextCursor },
      };
    },
  });
}
