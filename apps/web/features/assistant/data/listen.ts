// Ask Nova listening (`POST {p}/ai/speech-transcriptions`): a short recording turned into text by the speech service
// in Australia (X25) and not kept. The person reads and edits the words before asking.
import { unwrap } from '@archova/api-client';
import { api, ensureCsrfToken } from '@/shared/lib/api';

const CLIP_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav'] as const;

export async function transcribeClip(
  orgId: string,
  projectId: string,
  clip: Blob,
): Promise<string> {
  const base = clip.type.split(';')[0] ?? '';
  const mimeType = CLIP_TYPES.find((m) => m === base);
  if (!mimeType) throw new Error('This browser recorded in a format Nova cannot listen to.');
  await ensureCsrfToken();
  const bytes = new Uint8Array(await clip.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const heard = unwrap(
    await api.POST('/v1/orgs/{orgId}/projects/{projectId}/ai/speech-transcriptions', {
      params: { path: { orgId, projectId } },
      body: { audio: btoa(binary), mimeType },
    }),
  );
  return heard.text;
}
