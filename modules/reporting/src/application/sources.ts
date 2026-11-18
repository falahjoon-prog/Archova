import type { TenantScope } from '@archova/kernel';
import type { PlatformApi } from '@archova/mod-platform';
import type { DbpInspection, DbpObservation } from '../domain/dbp';
import type { ProjectSustainability } from '../domain/sustainability';
import {
  PROJECT_LIMIT,
  type BudgetSummary,
  type IncidentCounts,
  type ProgrammeCounts,
  type ReportSource,
  type SourceRow,
  type ToolCounts,
} from '../domain/report';

interface SourceRows {
  rows: readonly SourceRow[];
  truncated: boolean;
  restricted: boolean;
}

/** What `reporting` needs from the tool modules; each narrows to what the caller may read on that project. */
export interface ReportingDeps {
  platform: Pick<PlatformApi, 'listProjects'>;
  /** Waste, carbon, monitoring and permit-condition counts per project (`environment`); restricted unless readable. */
  environment: {
    portfolioSummary(scope: TenantScope, projectId: string): Promise<ProjectSustainability>;
  };
  rfis: Tool;
  defects: Tool;
  submittals: Tool;
  claims: Tool;
  variations: Tool;
  incidents: Tool<IncidentCounts>;
  /** Counts only for the dashboard: neither is a report-builder source yet. */
  observations: CountsOnly;
  inspections: CountsOnly;
  programme: Tool<ProgrammeCounts>;
  /** Inspection and observation rows for the DBP Act insights view (`quality`); restricted unless the caller may read them. */
  quality: {
    dbpRows(
      scope: TenantScope,
      projectId: string,
    ): Promise<{
      restricted: boolean;
      truncated: boolean;
      inspections: readonly DbpInspection[];
      observations: readonly DbpObservation[];
    }>;
  };
  /** Budget against forecast per project (`financials`); restricted unless the caller may read it. */
  budget: {
    portfolioSummary(scope: TenantScope, projectId: string): Promise<BudgetSummary>;
  };
  /** For the tender-readiness pack; each narrows to what the caller may read. */
  access: {
    can(
      scope: TenantScope,
      key: string,
      resource?: { projectId?: string | null },
    ): Promise<boolean>;
  };
  precon: {
    readinessSummary(scope: TenantScope): Promise<{
      companies: number;
      qualified: number;
      expiring: number;
      pending: number;
      expired: number;
      not_qualified: number;
      requiredForTenders: boolean;
    }>;
  };
  workforce: {
    credentialSummary(scope: TenantScope): Promise<{
      counts: { current: number; expiring: number; expired: number; no_expiry: number };
      items: readonly {
        itemType: string;
        title: string;
        insurer: string | null;
        expiresOn: string | null;
        evidence: 'recorded' | 'sighted' | 'self_declared';
        state: 'current' | 'expiring' | 'expired' | 'no_expiry';
      }[];
    }>;
  };
  safety: {
    readinessSummary(
      scope: TenantScope,
      projectId: string,
    ): Promise<{
      restricted: boolean;
      incidents: {
        total: number;
        notifiable: number;
        notClosed: number;
        bySeverity: { high: number; critical: number };
      };
      swms: { accepted: number; expired: number; awaitingReview: number; rejected: number };
    }>;
  };
  financials: {
    trustSummary(
      scope: TenantScope,
      projectId: string,
    ): Promise<{
      restricted: boolean;
      subcontracts: number;
      shortfallCents: number;
      ok: number;
      shortfall: number;
      not_set_up: number;
      not_required: number;
    }>;
  };
}

type CountsOnly = Pick<Tool, 'portfolioCounts'>;

interface Tool<C extends ToolCounts = ToolCounts> {
  portfolioCounts(scope: TenantScope, projectId: string): Promise<C>;
  reportRows(
    scope: TenantScope,
    projectId: string,
    opts: { state: 'open' | 'closed' | 'all'; limit: number },
  ): Promise<SourceRows>;
}

export const toolOf = (deps: ReportingDeps, source: ReportSource): Tool => deps[source];

export interface ProjectRef {
  id: string;
  name: string;
  number: string | null;
  status: string;
  phase: string | null;
  /** The Australian state the site is in, used to group the safety streaks by region. */
  state: string | null;
  siteLocation: { lat: number; lng: number } | null;
}

/** The projects the caller can see, in name order, up to the limit; `truncated` when there were more. */
export async function visibleProjects(
  deps: ReportingDeps,
  scope: TenantScope,
  opts: { includeClosed: boolean },
): Promise<{ projects: ProjectRef[]; truncated: boolean }> {
  const out: ProjectRef[] = [];
  let cursor: string | undefined;
  let truncated = false;
  for (;;) {
    const page = await deps.platform.listProjects(scope, {
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    for (const p of page.data) {
      if (!opts.includeClosed && (p.status === 'closed' || p.status === 'archived')) continue;
      if (out.length >= PROJECT_LIMIT) {
        truncated = true;
        break;
      }
      out.push({
        id: p.id,
        name: p.name,
        number: p.number,
        status: p.status,
        phase: p.phase ?? null,
        state: p.state ?? null,
        siteLocation:
          p.siteLat !== null && p.siteLng !== null ? { lat: p.siteLat, lng: p.siteLng } : null,
      });
    }
    if (truncated || !page.nextCursor) break;
    cursor = page.nextCursor;
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return { projects: out, truncated };
}
