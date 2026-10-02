// Chooses the provider implementation from config. Bedrock AU in deployed environments; the fake everywhere
// else, so tests and local runs never call a real model (and need no AWS credentials).
import type { ModelProvider } from '../../domain/provider';
import { createBedrockProvider } from './bedrock';
import { createFakeProvider, type FakeResponder } from './fake';

export { createFakeProvider, fakeEmbedding, type FakeProvider, type FakeResponder } from './fake';

export type ProviderConfig =
  | { kind: 'fake'; responders?: Record<string, FakeResponder> }
  | { kind: 'bedrock'; region: string; endpoint?: string };

export function createProvider(config: ProviderConfig): ModelProvider {
  if (config.kind === 'bedrock') {
    return createBedrockProvider({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    });
  }
  return createFakeProvider(config.responders ?? {});
}
