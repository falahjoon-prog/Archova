import { AppError, type TenantScope } from '@archova/kernel';
import { isLocalDate, localDateOf } from '@archova/time';
import {
  findGaps,
  packLines,
  type EvidencePack,
  type EvidenceSources,
} from '../domain/evidence-pack';
import { renderLinesPdf } from '../infra/pdf';
import type { ReportingDeps } from './sources';

const MAX_DAYS = 366 * 2;

const bad = (path: string, message: string): never => {
  throw new AppError('validation_failed', message, [{ path, message }]);
};

/**
 * The regulator evidence pack: one project's safety records for a date range, plus the pre-check for gaps. Each source
 * module narrows to what the caller may read and says so (`restricted`), so the pack never shows more than they could
 * open themselves. Nothing here calls a model.
 */
export function createEvidencePackService(deps: ReportingDeps & { now?: () => Date }) {
  const now = deps.now ?? (() => new Date());

  async function build(
    scope: TenantScope,
    projectId: string,
    range: { from: string; to: string },
  ): Promise<EvidencePack> {
    if (!isLocalDate(range.from) || !isLocalDate(range.to))
      bad('from', 'Use dates like 2026-11-21.');
    if (range.from > range.to) bad('to', 'The end date is before the start date.');
    if ((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000 > MAX_DAYS)
      bad('to', 'Choose a range of up to two years.');

    const project = await deps.platform.getProject(scope, projectId);
    const [safety, inductions, inspections] = await Promise.all([
      deps.safety.evidenceRecords(scope, projectId, range),
      deps.workforce.inductionEvidence(scope, projectId, range),
      deps.inspectionEvidence.inspections(scope, projectId, range),
    ]);
    const sources: EvidenceSources = { ...safety, inductions, inspections };
    const today = localDateOf(now(), project.timezone);
    return {
      project: { name: project.name, number: project.number ?? null, timeZone: project.timezone },
      from: range.from,
      to: range.to,
      generatedOn: today,
      ...sources,
      gaps: findGaps(sources, range, today),
    };
  }

  async function pdf(scope: TenantScope, projectId: string, range: { from: string; to: string }) {
    const pack = await build(scope, projectId, range);
    const bytes = await renderLinesPdf('Safety evidence pack', packLines(pack), now());
    return {
      filename: `safety-evidence-${pack.from}-to-${pack.to}.pdf`,
      contentType: 'application/pdf' as const,
      dataBase64: Buffer.from(bytes).toString('base64'),
    };
  }

  return { build, pdf };
}

export type EvidencePackService = ReturnType<typeof createEvidencePackService>;
