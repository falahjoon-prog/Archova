import { describe, expect, it } from 'vitest';
import { FAKE_MODELS, loadAiConfig } from '../../src';

const bedrock = {
  API_AI_PROVIDER: 'bedrock',
  API_AI_MODEL_FAST: 'au.anthropic.fast',
  API_AI_MODEL_STANDARD: 'au.anthropic.standard',
  API_AI_MODEL_ADVANCED: 'au.anthropic.advanced',
};

describe('loadAiConfig', () => {
  it('uses the fake provider when nothing is set', () => {
    expect(loadAiConfig({})).toEqual({ provider: { kind: 'fake' }, models: FAKE_MODELS });
  });

  it('reads Bedrock in Sydney with its endpoints and the embedding model', () => {
    expect(
      loadAiConfig({
        ...bedrock,
        API_AI_BEDROCK_ENDPOINT: 'https://bedrock.vpce.example',
        API_AI_TEXTRACT_ENDPOINT: 'https://textract.vpce.example',
      }),
    ).toEqual({
      provider: {
        kind: 'bedrock',
        region: 'ap-southeast-2',
        endpoint: 'https://bedrock.vpce.example',
        ocrEndpoint: 'https://textract.vpce.example',
      },
      models: {
        fast: 'au.anthropic.fast',
        standard: 'au.anthropic.standard',
        advanced: 'au.anthropic.advanced',
      },
      embedding: { model: 'amazon.titan-embed-text-v2:0' },
    });
  });

  it('refuses Bedrock without a model for every tier', () => {
    expect(() => loadAiConfig({ ...bedrock, API_AI_MODEL_ADVANCED: '' })).toThrow(
      /needs model ids for: API_AI_MODEL_ADVANCED/,
    );
  });

  it('keeps AI processing in Australia (X25)', () => {
    expect(() => loadAiConfig({ ...bedrock, API_AI_REGION: 'us-east-1' })).toThrow(
      /Australian region/,
    );
    expect(() => loadAiConfig({ ...bedrock, API_AI_MODEL_FAST: 'apac.anthropic.fast' })).toThrow(
      /outside Australia/,
    );
    expect(() =>
      loadAiConfig({ ...bedrock, API_AI_MODEL_EMBEDDING: 'global.cohere.embed' }),
    ).toThrow(/outside Australia/);
  });

  it('rejects an unknown provider and a malformed endpoint', () => {
    expect(() => loadAiConfig({ API_AI_PROVIDER: 'openai' })).toThrow(/fake or bedrock/);
    expect(() => loadAiConfig({ ...bedrock, API_AI_BEDROCK_ENDPOINT: 'not a url' })).toThrow(
      /API_AI_BEDROCK_ENDPOINT must be a URL/,
    );
  });
});
