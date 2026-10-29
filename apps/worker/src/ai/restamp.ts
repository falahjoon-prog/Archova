// Keeps what Nova stored about a document or drawing sheet true after the register changes it, with no model call and
// for any plan (backend 08 §2, ai/04 §3). Loaded by the ai-worker only.
//
// The text of a document or sheet revision never changes, so nothing is embedded here. What changes is around it: a
// document moved to a private folder must stop being retrievable by people outside that folder, and a new revision
// makes the old one superseded. Both are fixed in place, as soon as the event is processed. New revisions are
// embedded by the project index, not here. Acts as `AI_INDEX_ACTOR` in the event's own org, like the re-index.
import { documentSourceOf } from '@archova/mod-ai';
import type { TenantContext } from '@archova/kernel';
import type { Subscriber } from '../subscribers';
import { AI_RESTAMP_ROUTE } from './declaration';
import { indexContext, NO_PLAN, sanitizeFailure } from './reindex';

/** The one entry point of `modules.ai.api` the subscriber calls; it checks no permission, so only this file names it. */
export interface DocumentRestamper {
  restampSource(ctx: TenantContext, projectId: string, sourceId: string): Promise<void>;
}

export interface RestampDeps {
  ai: DocumentRestamper;
  /** Ids only: the stored text is never logged. */
  log: (msg: string, o: object) => void;
}

export function createRestamp(deps: RestampDeps): { subscriber: Subscriber } {
  const subscriber: Subscriber = {
    ...AI_RESTAMP_ROUTE,
    async handle(event) {
      const sourceId = documentSourceOf(event);
      if (!sourceId || !event.projectId) return;
      try {
        const ctx = indexContext(event.orgId, NO_PLAN, `ai-restamp:${event.id}`);
        await deps.ai.restampSource(ctx, event.projectId, sourceId);
        deps.log('ai restamp done', {
          orgId: event.orgId,
          projectId: event.projectId,
          sourceId,
          eventType: event.type,
        });
      } catch (err) {
        throw sanitizeFailure(err);
      }
    },
  };
  return { subscriber };
}
