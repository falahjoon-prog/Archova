// Nova's toolbox (ai/07 §3): the read-only lookups the Nova panel may call. Each wraps one module's existing
// permission-checked `api` method, so Nova sees exactly what the person asking could open, and a module gets Nova
// access by adding one entry here, not a new endpoint or prompt. Tools never change anything. A caller who may not
// see something gets a finding that says so; the answer repeats that and never guesses.
import { decodeId } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import type { NovaTool, ToolFinding } from '@archova/mod-ai';

interface Row {
  id: string;
  ref: string;
  title: string;
  detail: string;
}
interface Listing {
  rows: Row[];
  truncated: boolean;
  restricted: boolean;
}

export interface NovaToolSources {
  rfis: {
    overdueForMeeting: (
      s: TenantScope,
      projectId: string,
      o: { limit: number },
    ) => Promise<Listing>;
    summariesByIds: (
      s: TenantScope,
      projectId: string,
      ids: readonly string[],
    ) => Promise<
      Array<{
        id: string;
        ref: string;
        title: string;
        status: string;
        dueDate: string | null;
        scheduleImpactDays: number | null;
      }>
    >;
  };
  defects: {
    openForMeeting: (s: TenantScope, projectId: string, o: { limit: number }) => Promise<Listing>;
  };
  financials: {
    budgetReviewFacts: (
      s: TenantScope,
      projectId: string,
    ) => Promise<{
      hasBudget: boolean;
      status: string;
      lineCount: number;
      totals: { revised: string; committed: string; actual: string };
      findings: Array<{ summary: string }>;
    }>;
  };
  /** Created after `ai`, so read lazily. */
  scheduling: () => {
    slipSignals: (
      s: TenantScope,
      projectId: string,
    ) => Promise<{
      restricted: boolean;
      hasProgramme: boolean;
      lateCount: number;
      worst: Array<{
        wbs: string | null;
        name: string;
        finish: string;
        daysLate: number;
        pctComplete: number;
      }>;
    }>;
  };
}

const LIMIT = 20;
const noAccess = (what: string) =>
  `You don't have access to ${what} on this project, so Nova can't read it for you.`;

function listing(
  title: string,
  type: string,
  what: string,
  projectId: string,
  none: string,
  l: Listing,
): ToolFinding[] {
  if (l.restricted) return [{ title, type, id: projectId, text: noAccess(what) }];
  if (l.rows.length === 0) return [{ title, type, id: projectId, text: none }];
  const lines = l.rows.map((r) => `${r.ref} ${r.title} (${r.detail})`);
  if (l.truncated) lines.push(`Showing the first ${LIMIT}; there are more.`);
  return [{ title, type, id: projectId, text: lines.join('\n') }];
}

export function buildNovaTools(src: NovaToolSources): NovaTool[] {
  return [
    {
      name: 'overdue_rfis',
      description: 'Open RFIs that are past their due date, oldest due first.',
      params: {},
      run: async (scope, projectId) =>
        listing(
          'Overdue RFIs',
          'rfi',
          'RFIs',
          projectId,
          'No open RFIs are past their due date.',
          await src.rfis.overdueForMeeting(scope, projectId, { limit: LIMIT }),
        ),
    },
    {
      name: 'rfi_details',
      description: 'Number, subject, status, due date and schedule impact of one RFI.',
      params: {
        id: 'The RFI id (starts rfi_). Required. Use the open record\'s id when asked about "this".',
      },
      run: async (scope, projectId, args) => {
        const raw = args.id ?? '';
        const id = decodeId('rfi', raw);
        if (!id) return [];
        const [r] = await src.rfis.summariesByIds(scope, projectId, [id]);
        if (!r)
          return [
            {
              title: 'RFI',
              type: 'rfi',
              id: raw,
              text: 'This RFI was not found, or you cannot see it.',
            },
          ];
        const impact =
          r.scheduleImpactDays === null ? 'not assessed' : `${r.scheduleImpactDays} days`;
        return [
          {
            title: `${r.ref} ${r.title}`.slice(0, 120),
            type: 'rfi',
            id: raw,
            text: `${r.ref} ${r.title}. Status: ${r.status}. Due: ${r.dueDate ?? 'no due date'}. Schedule impact: ${impact}.`,
          },
        ];
      },
    },
    {
      name: 'open_defects',
      description: 'Defects still open, ready for review or disputed, grouped by trade.',
      params: {},
      run: async (scope, projectId) =>
        listing(
          'Open defects',
          'defect',
          'defects',
          projectId,
          'There are no open defects.',
          await src.defects.openForMeeting(scope, projectId, { limit: LIMIT }),
        ),
    },
    {
      name: 'late_programme_tasks',
      description:
        'Programme tasks past their finish date and not complete, with how many days late.',
      params: {},
      run: async (scope, projectId) => {
        const s = await src.scheduling().slipSignals(scope, projectId);
        const title = 'Late programme tasks';
        if (s.restricted)
          return [{ title, type: 'programme', id: projectId, text: noAccess('the programme') }];
        if (!s.hasProgramme)
          return [
            { title, type: 'programme', id: projectId, text: 'This project has no programme yet.' },
          ];
        const worst = s.worst.map((w) =>
          `${w.wbs ?? ''} ${w.name}: finish ${w.finish}, ${w.daysLate} days late, ${w.pctComplete}% complete`.trim(),
        );
        return [
          {
            title,
            type: 'programme',
            id: projectId,
            text: `${s.lateCount} tasks are past their finish date and not complete.${worst.length ? `\nLatest first:\n${worst.join('\n')}` : ''}`,
          },
        ];
      },
    },
    {
      name: 'budget_findings',
      description:
        'Budget totals (revised, committed, spent) and the checks that flag lines over-committed, over-spent or unbudgeted.',
      params: {},
      run: async (scope, projectId) => {
        const title = 'Budget checks';
        try {
          const b = await src.financials.budgetReviewFacts(scope, projectId);
          if (!b.hasBudget)
            return [
              { title, type: 'budget', id: projectId, text: 'This project has no budget yet.' },
            ];
          const findings = b.findings.length
            ? b.findings.map((f) => f.summary).join('\n')
            : 'The checks found nothing to flag.';
          return [
            {
              title,
              type: 'budget',
              id: projectId,
              text: `Budget (${b.status}, ${b.lineCount} lines): revised $${b.totals.revised}, committed $${b.totals.committed}, spent $${b.totals.actual}.\n${findings}`,
            },
          ];
        } catch (e) {
          if (e instanceof AppError)
            return [{ title, type: 'budget', id: projectId, text: noAccess('the budget') }];
          throw e;
        }
      },
    },
  ];
}
