// Reporting module: the portfolio dashboard and the report builder.
import { unwrap } from '@archova/api-client';
import { api } from '@/shared/lib/api';
import { startOfLocalDay } from '../lib/types';
import type {
  AuditFilters,
  AuditLogPage,
  DashboardSnapshot,
  DashboardSnapshotDetail,
  DashboardSnapshotInput,
  Portfolio,
  ReadinessPack,
  Report,
  ReportConfig,
  ReportInput,
  ReportResult,
} from '../lib/types';

const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export function createReportingApi(orgId: string) {
  const path = { orgId };
  return {
    async portfolio(includeClosed: boolean): Promise<Portfolio> {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/portfolio', {
          params: { path, query: { includeClosed: includeClosed ? 'true' : 'false' } },
        }),
      );
    },
    async auditLog(filters: AuditFilters, cursor: string | undefined): Promise<AuditLogPage> {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/audit-log', {
          params: {
            path,
            query: {
              limit: 50,
              ...(filters.projectId ? { projectId: filters.projectId } : {}),
              ...(filters.module ? { module: filters.module } : {}),
              ...(startOfLocalDay(filters.from) ? { from: startOfLocalDay(filters.from) } : {}),
              ...(startOfLocalDay(filters.to, 1) ? { to: startOfLocalDay(filters.to, 1) } : {}),
              ...(cursor ? { cursor } : {}),
            },
          },
        }),
      );
    },
    async snapshots(): Promise<DashboardSnapshot[]> {
      return unwrap(await api.GET('/v1/orgs/{orgId}/dashboard-snapshots', { params: { path } }))
        .data;
    },
    async snapshot(snapshotId: string): Promise<DashboardSnapshotDetail> {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/dashboard-snapshots/{snapshotId}', {
          params: { path: { orgId, snapshotId } },
        }),
      );
    },
    async createSnapshot(body: DashboardSnapshotInput): Promise<DashboardSnapshotDetail> {
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/dashboard-snapshots', {
          params: { path, header: idempotencyKey() },
          body,
        }),
      );
    },
    async removeSnapshot(snapshotId: string): Promise<void> {
      unwrap(
        await api.DELETE('/v1/orgs/{orgId}/dashboard-snapshots/{snapshotId}', {
          params: { path: { orgId, snapshotId } },
        }),
      );
    },
    async readiness(): Promise<ReadinessPack> {
      return unwrap(await api.GET('/v1/orgs/{orgId}/readiness-pack', { params: { path } }));
    },
    async readinessPdf(): Promise<File> {
      const r = unwrap(await api.GET('/v1/orgs/{orgId}/readiness-pack/pdf', { params: { path } }));
      const bytes = Uint8Array.from(atob(r.dataBase64), (c) => c.charCodeAt(0));
      return new File([bytes], r.filename, { type: r.contentType });
    },
    async reports(): Promise<Report[]> {
      return unwrap(await api.GET('/v1/orgs/{orgId}/reports', { params: { path } })).data;
    },
    async create(body: ReportInput): Promise<Report> {
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/reports', {
          params: { path, header: idempotencyKey() },
          body,
        }),
      );
    },
    async update(reportId: string, body: ReportInput): Promise<Report> {
      return unwrap(
        await api.PUT('/v1/orgs/{orgId}/reports/{reportId}', {
          params: { path: { orgId, reportId } },
          body,
        }),
      );
    },
    async remove(reportId: string): Promise<void> {
      unwrap(
        await api.DELETE('/v1/orgs/{orgId}/reports/{reportId}', {
          params: { path: { orgId, reportId } },
        }),
      );
    },
    async preview(body: ReportConfig): Promise<ReportResult> {
      return unwrap(await api.POST('/v1/orgs/{orgId}/reports/preview', { params: { path }, body }));
    },
  };
}
