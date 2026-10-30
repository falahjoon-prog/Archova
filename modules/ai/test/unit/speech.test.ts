import { describe, expect, it } from 'vitest';
import { ProviderError } from '../../src';
import { createFakeProvider } from '../../src/infra/providers/fake';
import { createTranscribe } from '../../src/infra/providers/transcribe';

const request = {
  audio: new Uint8Array([1, 2, 3]),
  mimeType: 'audio/webm',
  language: 'en-AU',
  timeoutMs: 1000,
};

describe('speech to text (Nova listening)', () => {
  it('the fake provider hears a stand-in question unless a test scripts it', async () => {
    const fake = createFakeProvider();
    expect((await fake.transcribe(request)).text).toMatch(/quote/);
    fake.onSpeech(() => ({ text: 'Draft a message' }));
    expect((await fake.transcribe(request)).text).toBe('Draft a message');
    expect(fake.speechCalls).toHaveLength(2);
  });

  it('a deployed environment refuses plainly until the Australian speech service is connected', async () => {
    const adapter = createTranscribe('ap-southeast-2');
    await expect(adapter.transcribe(request)).rejects.toBeInstanceOf(ProviderError);
  });

  it('never sets up speech outside Australia (X25)', () => {
    expect(() => createTranscribe('us-east-1')).toThrow(/outside Australia/);
  });
});
