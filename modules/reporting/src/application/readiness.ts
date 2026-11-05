import type { TenantScope } from '@archova/kernel';
import { localDateOf } from '@archova/time';
import {
  attentionItems,
  type Attention,
  type CredentialItem,
  type ReadinessPack,
} from '../domain/readiness';
import { renderReadinessPdf } from '../infra/pdf';
import { visibleProjects, type ReportingDeps } from './sources';

const TIME_ZONE = 'Australia/Sydney';

export function createReadinessService(deps: ReportingDeps & { now?: () => Date }) {
  const now = deps.now ?? (() => new Date());

  /** Each section is limited to what the caller may read: an org-level section they can't open is `restricted`. */
  async function build(scope: TenantScope): Promise<ReadinessPack & { attention: Attention[] }> {
    const [canPrequal, canWallet] = await Promise.all([
      deps.access.can(scope, 'precon.prequal.view'),
      deps.access.can(scope, 'workforce.wallet.view'),
    ]);

    const q = canPrequal ? await deps.precon.readinessSummary(scope) : null;
    const prequal = {
      restricted: !q,
      companies: q?.companies ?? 0,
      qualified: q?.qualified ?? 0,
      expiring: q?.expiring ?? 0,
      pending: q?.pending ?? 0,
      expired: q?.expired ?? 0,
      notQualified: q?.not_qualified ?? 0,
      requiredForTenders: q?.requiredForTenders ?? false,
    };

    const w = canWallet ? await deps.workforce.credentialSummary(scope) : null;
    const credentials = {
      restricted: !w,
      current: w?.counts.current ?? 0,
      expiring: w?.counts.expiring ?? 0,
      expired: w?.counts.expired ?? 0,
      noExpiry: w?.counts.no_expiry ?? 0,
      items: (w?.items ?? []) as CredentialItem[],
    };

    const { projects, truncated } = await visibleProjects(deps, scope, { includeClosed: true });
    const safety: ReadinessPack['safety'] = {
      projectsCovered: 0,
      projectsRestricted: 0,
      incidents: { total: 0, notifiable: 0, notClosed: 0, high: 0, critical: 0 },
      swms: { accepted: 0, expired: 0, awaitingReview: 0, rejected: 0 },
    };
    const trust: ReadinessPack['trust'] = {
      projectsCovered: 0,
      projectsRestricted: 0,
      subcontracts: 0,
      ok: 0,
      shortfall: 0,
      notSetUp: 0,
      notRequired: 0,
      shortfallCents: 0,
    };
    for (const p of projects) {
      const s = await deps.safety.readinessSummary(scope, p.id);
      if (s.restricted) safety.projectsRestricted += 1;
      else {
        safety.projectsCovered += 1;
        safety.incidents.total += s.incidents.total;
        safety.incidents.notifiable += s.incidents.notifiable;
        safety.incidents.notClosed += s.incidents.notClosed;
        safety.incidents.high += s.incidents.bySeverity.high;
        safety.incidents.critical += s.incidents.bySeverity.critical;
        safety.swms.accepted += s.swms.accepted;
        safety.swms.expired += s.swms.expired;
        safety.swms.awaitingReview += s.swms.awaitingReview;
        safety.swms.rejected += s.swms.rejected;
      }
      const t = await deps.financials.trustSummary(scope, p.id);
      if (t.restricted) trust.projectsRestricted += 1;
      else {
        trust.projectsCovered += 1;
        trust.subcontracts += t.subcontracts;
        trust.ok += t.ok;
        trust.shortfall += t.shortfall;
        trust.notSetUp += t.not_set_up;
        trust.notRequired += t.not_required;
        trust.shortfallCents += t.shortfallCents;
      }
    }

    const pack: ReadinessPack = {
      generatedOn: localDateOf(now(), TIME_ZONE),
      timeZone: TIME_ZONE,
      prequal,
      credentials,
      safety,
      trust,
      truncated,
    };
    return { ...pack, attention: attentionItems(pack) };
  }

  async function pdf(scope: TenantScope) {
    const pack = await build(scope);
    const bytes = await renderReadinessPdf(pack, now());
    return {
      filename: `tender-readiness-${pack.generatedOn}.pdf`,
      contentType: 'application/pdf' as const,
      dataBase64: Buffer.from(bytes).toString('base64'),
    };
  }

  return { build, pdf };
}

export type ReadinessService = ReturnType<typeof createReadinessService>;
