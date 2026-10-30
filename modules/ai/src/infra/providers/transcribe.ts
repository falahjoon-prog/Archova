// Speech to text in Australia (Amazon Transcribe, Sydney) is not wired yet: local runs use the fake provider, which
// hears a stand-in question. Deployed environments refuse the call plainly until the Transcribe adapter lands, so a
// clip is never sent anywhere outside Australia by accident (X25).
import type { SpeechRequest, SpeechResponse } from '../../domain/provider';
import { ProviderError } from '../../domain/provider';
import { isAustralianRegion } from '../../domain/routing';

export function createTranscribe(region: string): {
  transcribe(req: SpeechRequest): Promise<SpeechResponse>;
} {
  if (!isAustralianRegion(region)) {
    throw new Error(
      `Speech region ${region} is outside Australia; AI processing must stay in Australia (X25)`,
    );
  }
  return {
    async transcribe() {
      throw new ProviderError(
        'unavailable',
        'Speech to text is not connected in this environment yet',
      );
    },
  };
}
