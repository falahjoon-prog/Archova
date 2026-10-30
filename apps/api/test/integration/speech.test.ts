import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrg, createProject, createTestContext, signUp, type TestContext } from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

const clip = (bytes: number) => Buffer.alloc(bytes, 1).toString('base64');

async function setup(name: string) {
  const pm = await signUp(t.app, name);
  const org = await createOrg(pm.browser, `${name} Builders`);
  const project = await createProject(pm.browser, org.id, { name: 'Voice Tower', state: 'QLD' });
  return { pm, base: `/v1/orgs/${org.id}/projects/${project.id}` };
}

describe('Nova listening (speech to text)', () => {
  it('turns a short clip into text, in Australia, and keeps the audio out of the log', async () => {
    const s = await setup('voice-a');
    t.ai.onSpeech(() => ({ text: ' Counter-offer ideas for this quote ' }));
    const before = t.ai.speechCalls.length;
    const res = await s.pm.browser.post(`${s.base}/ai/speech-transcriptions`, {
      audio: clip(2000),
      mimeType: 'audio/webm',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ text: 'Counter-offer ideas for this quote' });
    expect(res.json().runId).toMatch(/^air_/);
    const call = t.ai.speechCalls.slice(before).at(-1)!;
    expect(call.language).toBe('en-AU');
    expect(call.audio.length).toBe(2000);
  });

  it('says so when nothing is heard, and refuses a clip that is too long', async () => {
    const s = await setup('voice-b');
    t.ai.onSpeech(() => ({ text: '  ' }));
    const quiet = await s.pm.browser.post(`${s.base}/ai/speech-transcriptions`, {
      audio: clip(500),
      mimeType: 'audio/webm',
    });
    expect(quiet.statusCode).toBe(422);
    expect(quiet.json()).toMatchObject({ code: 'ai.nothing_heard' });
    const long = await s.pm.browser.post(`${s.base}/ai/speech-transcriptions`, {
      audio: clip(700_000),
      mimeType: 'audio/webm',
    });
    expect(long.statusCode).toBe(422);
  });
});
