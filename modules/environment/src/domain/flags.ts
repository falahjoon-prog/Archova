// Rule-based flags Nova raises over the environmental register. No model, no credit cost: each is a plain
// check of the register against today's date. Pure, no IO.
import { daysBetween } from '@archova/time';
import { expiryState } from './document';
import { isConditionOverdue, conditionLabel, type ConditionStatus } from './condition';

export type FlagSeverity = 'info' | 'warning' | 'critical';

export interface EnvironmentFlag {
  code:
    | 'conditions_non_compliant'
    | 'conditions_overdue'
    | 'documents_expired'
    | 'documents_expiring'
    | 'plan_missing'
    | 'plan_unapproved'
    | 'plan_review_due';
  severity: FlagSeverity;
  message: string;
  /** Ids (internal uuids; the route encodes them) of the conditions or documents the flag is about. */
  conditionIds: string[];
  documentIds: string[];
}

interface FlagInput {
  today: string;
  plan: { status: 'draft' | 'active'; nextReviewDate: string | null } | null;
  conditions: { id: string; number: number; status: ConditionStatus; dueDate: string | null }[];
  documents: { id: string; title: string; expiresOn: string | null }[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function environmentFlags(i: FlagInput): EnvironmentFlag[] {
  const flags: EnvironmentFlag[] = [];
  const nonCompliant = i.conditions.filter((c) => c.status === 'non_compliant');
  if (nonCompliant.length > 0)
    flags.push({
      code: 'conditions_non_compliant',
      severity: 'critical',
      message: `${plural(nonCompliant.length, 'condition')} flagged non-compliant (${nonCompliant
        .slice(0, 3)
        .map((c) => conditionLabel(c.number))
        .join(
          ', ',
        )}${nonCompliant.length > 3 ? ', …' : ''}). Close each out or record the corrective action.`,
      conditionIds: nonCompliant.map((c) => c.id),
      documentIds: [],
    });
  const overdue = i.conditions.filter(
    (c) => c.status !== 'non_compliant' && isConditionOverdue(c, i.today),
  );
  if (overdue.length > 0)
    flags.push({
      code: 'conditions_overdue',
      severity: 'warning',
      message: `${plural(overdue.length, 'sign-off')} overdue. Sign them off with evidence or raise a non-compliance.`,
      conditionIds: overdue.map((c) => c.id),
      documentIds: [],
    });
  const expired = i.documents.filter((d) => expiryState(d.expiresOn, i.today) === 'expired');
  if (expired.length > 0)
    flags.push({
      code: 'documents_expired',
      severity: 'critical',
      message: `${plural(expired.length, 'document')} expired: ${expired
        .slice(0, 2)
        .map((d) => d.title)
        .join(', ')}${expired.length > 2 ? ', …' : ''}. Upload the renewed version.`,
      conditionIds: [],
      documentIds: expired.map((d) => d.id),
    });
  const expiring = i.documents.filter((d) => expiryState(d.expiresOn, i.today) === 'expiring');
  if (expiring.length > 0)
    flags.push({
      code: 'documents_expiring',
      severity: 'warning',
      message: `${plural(expiring.length, 'document')} expire within 30 days.`,
      conditionIds: [],
      documentIds: expiring.map((d) => d.id),
    });
  if (!i.plan)
    flags.push({
      code: 'plan_missing',
      severity: 'warning',
      message: 'No Environmental Management Plan is set up for this project yet.',
      conditionIds: [],
      documentIds: [],
    });
  else {
    if (i.plan.status === 'draft')
      flags.push({
        code: 'plan_unapproved',
        severity: 'info',
        message: 'The EMP is still a draft. Approve it once the permit conditions are loaded.',
        conditionIds: [],
        documentIds: [],
      });
    if (i.plan.nextReviewDate && i.plan.nextReviewDate < i.today)
      flags.push({
        code: 'plan_review_due',
        severity: 'warning',
        message: `The EMP review was due ${plural(daysBetween(i.plan.nextReviewDate, i.today), 'day')} ago.`,
        conditionIds: [],
        documentIds: [],
      });
  }
  return flags;
}
