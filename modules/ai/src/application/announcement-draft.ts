// Nova drafts a project announcement from the notes a person typed or pasted (Ai on top). Nothing is posted or saved:
// the person edits the draft and posts it through the announcements module. Only the notes go to the model, never
// project records, so there is nothing to scope or redact.
import { announcementDraftPrompt } from '@archova/ai-prompts';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import { reviewAnnouncementDraft } from '../domain/announcement-draft';
import type { Gateway } from './gateway';

export const ANNOUNCEMENT_DRAFT_PERMISSION = 'announcements.announcements.create';

export interface AnnouncementDraftDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask'>;
  assert: (scope: TenantScope, key: string, target: { projectId: string }) => Promise<void>;
}

export function createAnnouncementDraftService(deps: AnnouncementDraftDeps) {
  async function draft(
    ctx: TenantContext,
    projectId: string,
    input: { notes: string; audience?: string },
    signal?: AbortSignal,
  ) {
    const notes = input.notes.trim();
    if (!notes)
      throw new AppError('validation_failed', 'Write a few notes about what changed.', [
        { path: 'notes', message: 'Notes are needed' },
      ]);
    await deps.database.withTenantTx(
      ctx,
      (scope) => deps.assert(scope, ANNOUNCEMENT_DRAFT_PERMISSION, { projectId }),
      { readOnly: true },
    );
    const audience = (input.audience ?? '').trim();
    const run = await deps.gateway.runTask(
      ctx,
      announcementDraftPrompt,
      { notes, audience },
      { projectId, ...(signal ? { signal } : {}) },
    );
    if (run.status !== 'ok')
      throw new AppError('ai.invalid_output', "Nova couldn't draft this announcement. Try again.");
    const reviewed = reviewAnnouncementDraft(run.output, notes);
    if (!reviewed.body)
      throw new AppError(
        'ai.invalid_output',
        "Nova couldn't write a message the notes fully support. Add more detail and try again.",
      );
    return { runId: run.runId, ...reviewed };
  }
  return { draft };
}

export type AnnouncementDraftService = ReturnType<typeof createAnnouncementDraftService>;
