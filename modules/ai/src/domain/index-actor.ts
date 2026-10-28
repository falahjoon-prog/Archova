// Who Nova's background work acts as when no person started it: the re-index that follows a record change.

/**
 * The system actor of the ai-worker's re-index. It is a reserved id, never a user: it sits in no project and holds no
 * org role, so every `access.can` check fails for it and a retrieval that reached for the actor's scopes would find
 * none (`aiAccessScopes` returns []). It is not the nil uuid, which `diary` and `workforce` read as "no company".
 * `ai_requests` and the usage ledger record it as `user_id`, which tells a background run from a person's.
 */
export const AI_INDEX_ACTOR = '00000000-0000-4000-8000-0000000a1001';
