// Site photo tagging: a photo already uploaded to the project is read for the area, trade and tags that file it in
// the project photo library. Nova only suggests; the person confirms or edits the tags through the files module, so
// nothing is stored here beyond the run record. The photo is read through the caller's own file access.
import { photoTagPrompt } from '@archova/ai-prompts';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import { reviewPhotoTag, type ReviewedPhotoTag } from '../domain/photo-tag';
import type { ReadableFile } from './drawing-register';
import type { Gateway } from './gateway';
import { MAX_PHOTO_BYTES, toSitePhoto } from './site-photo';

export interface PhotoTagDeps {
  database: Database;
  gateway: Pick<Gateway, 'runTask'>;
  assert: (scope: TenantScope, key: string, target: { projectId: string }) => Promise<void>;
  readFile: (scope: TenantScope, fileId: string, maxBytes: number) => Promise<ReadableFile>;
}

export interface PhotoTagSuggestion extends ReviewedPhotoTag {
  runId: string;
}

export function createPhotoTagService(deps: PhotoTagDeps) {
  const { database } = deps;
  const ro = { readOnly: true, statementTimeout: '60s' } as const;

  async function suggest(
    ctx: TenantContext,
    projectId: string,
    input: { note: string; knownAreas: string[]; photoFileId: string },
    signal?: AbortSignal,
  ): Promise<PhotoTagSuggestion> {
    const note = input.note.trim();
    const knownAreas = input.knownAreas.map((a) => a.trim()).filter(Boolean);
    const file = await database.withTenantTx(
      ctx,
      async (scope) => {
        await deps.assert(scope, 'ai.photo_tag.suggest', { projectId });
        return deps.readFile(scope, input.photoFileId, MAX_PHOTO_BYTES);
      },
      ro,
    );
    const photo = toSitePhoto(file, projectId);
    const run = await deps.gateway.runTask(
      ctx,
      photoTagPrompt,
      { note, knownAreas, photo },
      { projectId, ...(signal ? { signal } : {}) },
    );
    if (run.status !== 'ok')
      throw new AppError('ai.invalid_output', "Nova couldn't read this photo. Try again.");
    return { runId: run.runId, ...reviewPhotoTag(run.output, { knownAreas }) };
  }

  return { suggest };
}

export type PhotoTagService = ReturnType<typeof createPhotoTagService>;
