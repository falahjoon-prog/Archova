// Publishes a newly current drawing revision to the SharePoint or Google Drive folders linked to its project
// (integrations/03 M2, 04 G2). One way: Archova is the record. Loaded by the ai-worker only, because that is the process
// that loads the modules. Safe to repeat: a revision already published to a link is skipped and an upload replaces a file
// of the same name. A transient provider error throws so the dispatcher retries; anything that needs a person is stored on
// the link for the admin to see.
import type { Modules } from '@archova/compose';
import type { Subscriber } from '../subscribers';
import { jobContext } from '../subscribers';
import { FOLDER_BACKFILL_ROUTE, FOLDER_PUBLISH_ROUTE } from './declaration';

export interface FolderPublishDeps {
  documents: Pick<Modules['documents']['api'], 'currentDrawingRevisions'>;
  folders: Pick<Modules['integrations']['api']['folders'], 'publishRevision'>;
  log: (msg: string, o: object) => void;
}

export function createFolderPublish(deps: FolderPublishDeps): {
  subscriber: Subscriber;
  backfill: Subscriber;
} {
  const subscriber: Subscriber = {
    ...FOLDER_PUBLISH_ROUTE,
    async handle(event, { database }) {
      const d = event.data as Record<string, unknown> | null;
      const str = (k: string) => (typeof d?.[k] === 'string' ? (d[k] as string) : null);
      const sheetId = str('sheetId');
      const revisionId = str('revisionId');
      const sheetNumber = str('sheetNumber');
      const rev = str('rev');
      const fileId = str('fileId');
      if (!event.projectId || !sheetId || !revisionId || !sheetNumber || !rev || !fileId) return;
      const out = await deps.folders.publishRevision(
        database,
        jobContext(event.orgId, `folders.publish:${event.id}`),
        {
          projectId: event.projectId,
          sheetId,
          revisionId,
          sheetNumber,
          rev,
          previousRevisionId: str('previousRevisionId'),
          fileId,
        },
      );
      if (out.published) deps.log('folder publish', { orgId: event.orgId, revisionId, ...out });
    },
  };
  // Safe to repeat: a revision already published to a link is skipped. Each revision runs in its own transactions, so a
  // large set never holds a connection while it uploads, and a retry resumes where the last attempt stopped.
  const backfill: Subscriber = {
    ...FOLDER_BACKFILL_ROUTE,
    async handle(event, { database }) {
      if (!event.projectId) return;
      const projectId = event.projectId;
      const ctx = jobContext(event.orgId, `folders.backfill:${event.id}`);
      const current = await database.withTenantTx(
        ctx,
        (scope) => deps.documents.currentDrawingRevisions(scope, projectId),
        { readOnly: true },
      );
      let published = 0;
      for (const r of current) {
        const out = await deps.folders.publishRevision(database, ctx, {
          projectId,
          ...r,
          previousRevisionId: null,
        });
        published += out.published;
      }
      deps.log('folder backfill', {
        orgId: event.orgId,
        projectId,
        sheets: current.length,
        published,
      });
    },
  };
  return { subscriber, backfill };
}
