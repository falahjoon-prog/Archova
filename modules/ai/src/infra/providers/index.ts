// Chooses the provider implementation from config. Bedrock AU in deployed environments; the fake everywhere
// else, so tests and local runs never call a real model (and need no AWS credentials).
import type { ModelProvider } from '../../domain/provider';
import { createBedrockProvider } from './bedrock';
import { heuristicTitleBlock } from '../../eval/suites/drawing-titleblock';
import { heuristicQaAnswer } from '../../eval/suites/qa-answer';
import { createFakeProvider, type FakeResponder } from './fake';

/**
 * What the fake provider answers with when nothing is scripted: deterministic stand-ins, so local development
 * shows plausible Nova output without a model.
 */
export const DEFAULT_FAKE_RESPONDERS: Readonly<Record<string, FakeResponder>> = {
  'drawing.titleblock': heuristicTitleBlock,
  'qa.answer': heuristicQaAnswer,
};

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
  return createFakeProvider({ ...DEFAULT_FAKE_RESPONDERS, ...config.responders });
}
