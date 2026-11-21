import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

export type Scorecard = components['schemas']['SafetyScorecard'];

/** Builder staff only; anyone else gets a refusal and the screen says so. */
export async function listScorecards(orgId: string, projectId: string): Promise<Scorecard[]> {
  const res = await api.GET('/v1/orgs/{orgId}/projects/{projectId}/safety-scorecards', {
    params: { path: { orgId, projectId } },
  } as never);
  return (unwrap(res as never) as components['schemas']['SafetyScorecardList']).data;
}

const card = (
  n: number,
  name: string,
  score: number,
  rating: Scorecard['rating'],
  trend: Scorecard['trend'],
  flags: string[],
): Scorecard => ({
  companyId: `cmp_${n}`,
  name,
  score,
  rating,
  trend,
  flags,
  riskFlag: flags.length
    ? `${name}: ${rating} safety risk (score ${score}/100, ${trend}). ${flags.join('; ')}.`
    : null,
  components: [
    {
      key: 'incidents',
      label: 'Incidents (12 months)',
      lost: 100 - score > 40 ? 40 : 100 - score,
      max: 40,
      detail: flags[0] ?? 'No incidents involving this company',
    },
    {
      key: 'actions',
      label: 'Corrective actions',
      lost: 0,
      max: 20,
      detail: 'No corrective actions assigned',
    },
    { key: 'swms', label: 'SWMS', lost: 0, max: 10, detail: 'No SWMS submitted' },
    {
      key: 'inductions',
      label: 'Induction compliance',
      lost: 0,
      max: 15,
      detail: 'No pre-task plan sign-ons yet',
    },
    {
      key: 'findings',
      label: 'Safety observations',
      lost: 0,
      max: 15,
      detail: 'No safety observations raised',
    },
  ],
  counts: {
    incidents12m: flags.length,
    incidents90d: flags.length ? 1 : 0,
    notifiable12m: 0,
    projects: 1,
    overdueActions: 0,
  },
});

/** Sample data for the design preview. */
export const previewScorecards: Scorecard[] = [
  card(1, 'Harbour Formwork', 38, 'high', 'worsening', [
    '2 high-severity incidents in the last 90 days',
    '3 overdue corrective actions',
  ]),
  card(2, 'Metro Electrical', 72, 'watch', 'steady', ['1 overdue corrective action']),
  card(3, 'Apex Concrete', 100, 'good', 'steady', []),
];
