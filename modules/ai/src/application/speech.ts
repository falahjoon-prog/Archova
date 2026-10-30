// Nova listening: one short spoken question turned into text, so an estimator can talk instead of type. The clip is
// sent to the speech service in Australia through the gateway (X25) and is not kept; only the text comes back, and the
// person reads and edits it before it goes anywhere.
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import type { Gateway } from './gateway';

export const SPEECH_PERMISSION = 'ai.ask.use';
/** What the API accepts: a clip of about a minute at phone quality. */
export const MAX_CLIP_BYTES = 650_000;
export const CLIP_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav'] as const;

export interface SpeechDeps {
  database: Database;
  gateway: Pick<Gateway, 'transcribe'>;
  assert: (scope: TenantScope, key: string, target: { projectId: string }) => Promise<void>;
}

export function createSpeechService(deps: SpeechDeps) {
  async function transcribe(
    ctx: TenantContext,
    projectId: string,
    clip: { audio: Uint8Array; mimeType: string },
  ): Promise<{ runId: string; text: string }> {
    if (!clip.audio.length || clip.audio.length > MAX_CLIP_BYTES)
      throw new AppError(
        'validation_failed',
        'The recording is empty or too long. Try a shorter question.',
        [{ path: 'audio', message: 'Record up to about a minute' }],
      );
    await deps.database.withTenantTx(
      ctx,
      (scope) => deps.assert(scope, SPEECH_PERMISSION, { projectId }),
      { readOnly: true },
    );
    const r = await deps.gateway.transcribe(ctx, { ...clip, projectId });
    if (!r.text)
      throw new AppError(
        'ai.nothing_heard',
        "Nova couldn't hear a question in that recording. Try again, or type it.",
      );
    return r;
  }
  return { transcribe };
}
export type SpeechService = ReturnType<typeof createSpeechService>;
