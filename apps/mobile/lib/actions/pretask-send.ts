// Replays a pre-task plan taken on site with no signal: creates the plan, uploads and applies each signature drawn on
// the phone, then closes it if the supervisor asked. The plan id is the queued action's id, used as the idempotency
// key, so a reply lost on the way cannot start the plan twice. Every step looks at the plan as the server has it, so
// a replay after a partial send carries on from where it stopped instead of signing anyone twice.
import { unwrap, type ApiClient } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';

export type PretaskHazardInput = components['schemas']['PretaskHazard'];

export interface PretaskStroke {
  x: number;
  y: number;
}

export interface PretaskCrewDraft {
  personName: string;
  companyId?: string;
  userId?: string;
  /** The signature drawn on the phone, in 0..1 of the pad. Absent when the person has not signed yet. */
  strokes?: PretaskStroke[][];
}

export interface PretaskSubmitPayload {
  taskTitle: string;
  workDate: string;
  supervisorName: string;
  location?: string;
  companyId?: string;
  swmsId?: string;
  hazards: PretaskHazardInput[];
  crew: PretaskCrewDraft[];
  /** Close the plan once everyone has signed. */
  close: boolean;
}

/** Stores one signature picture and returns the id of the stored file. Throws if the transfer fails. */
export type SignatureUploader = (
  key: string,
  projectId: string,
  strokes: PretaskStroke[][],
) => Promise<string>;

type Detail = components['schemas']['PretaskPlanDetail'];

const P = '/v1/orgs/{orgId}/projects/{projectId}' as const;
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });

export function submitPayload(p: Record<string, unknown>): PretaskSubmitPayload {
  return p as unknown as PretaskSubmitPayload;
}

export async function sendPretaskPlan(
  api: ApiClient,
  orgId: string,
  action: { id: string; projectId: string; payload: Record<string, unknown> },
  uploadSignature: SignatureUploader,
): Promise<void> {
  const p = submitPayload(action.payload);
  const path = { orgId, projectId: action.projectId };

  const created = unwrap(
    await api.POST(`${P}/pretask-plans`, {
      params: { path, header: { 'Idempotency-Key': action.id } },
      body: {
        taskTitle: p.taskTitle,
        workDate: p.workDate,
        supervisorName: p.supervisorName,
        hazards: p.hazards,
        ...(p.location ? { location: p.location } : {}),
        ...(p.companyId ? { companyId: p.companyId } : {}),
        ...(p.swmsId ? { swmsId: p.swmsId } : {}),
        ...(p.crew.length
          ? {
              crew: p.crew.map((c) => ({
                personName: c.personName,
                ...(c.companyId ? { companyId: c.companyId } : {}),
                ...(c.userId ? { userId: c.userId } : {}),
              })),
            }
          : {}),
      },
    } as never),
  ) as Detail;
  const planId = created.plan.id;
  const planPath = { ...path, planId };

  // A replayed create returns the first answer, so read the plan as it is now.
  let detail = unwrap(
    await api.GET(`${P}/pretask-plans/{planId}`, { params: { path: planPath } } as never),
  ) as Detail;

  const claimed = new Set<string>();
  for (const [i, person] of p.crew.entries()) {
    const row = detail.crew.find((c) => c.personName === person.personName && !claimed.has(c.id));
    if (!row) continue;
    claimed.add(row.id);
    if (!person.strokes || row.signedAt) continue;
    const fileId = await uploadSignature(`${action.id}:${i}`, action.projectId, person.strokes);
    detail = unwrap(
      await api.PUT(`${P}/pretask-plans/{planId}/crew/{crewId}/signature`, {
        params: {
          path: { ...planPath, crewId: row.id },
          header: ifMatch(detail.plan.version),
        },
        body: { signatureFileId: fileId },
      } as never),
    ) as Detail;
  }

  if (p.close && detail.plan.status === 'open') {
    unwrap(
      await api.POST(`${P}/pretask-plans/{planId}/transition`, {
        params: { path: planPath, header: ifMatch(detail.plan.version) },
        body: { action: 'close' },
      } as never),
    );
  }
}
