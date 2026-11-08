// Deleting the signed-in person's account (identity module, `DELETE /v1/me`). Both app stores require this in the
// app. The server decides whether it can go ahead; this maps its answers to what the screen should say.

export interface BlockingOrg {
  id: string;
  name: string;
}

export type DeleteAccountOutcome =
  | { status: 'deleted' }
  /** The last sign-in is more than 15 minutes old: sign in again, then retry. */
  | { status: 'needs_recent_sign_in' }
  /** Organisations others still use have no other owner. */
  | { status: 'sole_owner'; orgs: BlockingOrg[] }
  /** The person's own empty organisation can't be closed because of a platform hold. */
  | { status: 'org_on_hold' }
  | { status: 'error'; message: string };

export interface DeleteMeResult {
  response: { ok: boolean; status: number };
  error?: unknown;
}

function problemOf(error: unknown): { code?: string; orgs?: unknown } {
  return error && typeof error === 'object' ? (error as { code?: string; orgs?: unknown }) : {};
}

function orgsOf(value: unknown): BlockingOrg[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((o) => {
    if (!o || typeof o !== 'object') return [];
    const { id, name } = o as { id?: unknown; name?: unknown };
    return typeof id === 'string' ? [{ id, name: typeof name === 'string' ? name : id }] : [];
  });
}

/** `send` is the typed `DELETE /v1/me` call with `{ confirm: 'DELETE' }`; a network failure rejects. */
export async function deleteAccount(
  send: () => Promise<DeleteMeResult>,
): Promise<DeleteAccountOutcome> {
  let result: DeleteMeResult;
  try {
    result = await send();
  } catch {
    return {
      status: 'error',
      message: 'Could not reach Archova. Check your connection and try again.',
    };
  }
  if (result.response.ok) return { status: 'deleted' };
  const problem = problemOf(result.error);
  if (problem.code === 'auth.step_up_required') return { status: 'needs_recent_sign_in' };
  if (problem.code === 'account.sole_owner')
    return { status: 'sole_owner', orgs: orgsOf(problem.orgs) };
  if (problem.code === 'account.org_on_hold') return { status: 'org_on_hold' };
  return {
    status: 'error',
    message: 'Your account could not be deleted. Try again, or contact support.',
  };
}
