// Chooses the provider implementation from config. Bedrock and Textract in AU in deployed environments; the fake
// everywhere else, so tests and local runs never call a real model (and need no AWS credentials).
import type { ModelProvider } from '../../domain/provider';
import { createBedrockProvider } from './bedrock';
import { heuristicDefectTag } from '../../eval/suites/defect-tag';
import { heuristicImportMapping } from '../../eval/suites/import-mapping';
import { heuristicDiarySummary } from '../../eval/suites/diary-summary';
import { heuristicDiaryWeekly } from '../../eval/suites/diary-weekly';
import { heuristicDrawingCompare } from '../../eval/suites/drawing-compare';
import { heuristicDrawingCompareVisual } from '../../eval/suites/drawing-compare-visual';
import { heuristicTitleBlock } from '../../eval/suites/drawing-titleblock';
import { heuristicInductionDraft } from '../../eval/suites/induction-draft';
import { heuristicQaAnswer } from '../../eval/suites/qa-answer';
import { heuristicQaRerank, heuristicQaRewrite } from '../../eval/suites/qa-retrieval';
import { heuristicQuoteNegotiate } from '../../eval/suites/quote-negotiate';
import { heuristicContractReview } from '../../eval/suites/contract-review';
import { heuristicTakeoffDetect } from '../../eval/suites/takeoff-detect';
import { heuristicQuoteRead } from '../../eval/suites/quote-read';
import { heuristicRfiAnswer } from '../../eval/suites/rfi-answer';
import { heuristicRfiDraft } from '../../eval/suites/rfi-draft';
import { fakeTranslate, fakeTranslationCheck } from '../../eval/suites/translation';
import { createFakeProvider, type FakeResponder } from './fake';
import { createTextractOcr } from './textract';
import { createTranscribe } from './transcribe';

/**
 * What the fake provider answers with when nothing is scripted: deterministic stand-ins, so local development
 * shows plausible Nova output without a model.
 */
export const DEFAULT_FAKE_RESPONDERS: Readonly<Record<string, FakeResponder>> = {
  'drawing.titleblock': heuristicTitleBlock,
  'qa.rewrite': heuristicQaRewrite,
  'qa.rerank': heuristicQaRerank,
  'qa.answer': heuristicQaAnswer,
  'induction.draft': heuristicInductionDraft,
  'induction.refresh': heuristicInductionDraft,
  'induction.ask': heuristicQaAnswer,
  'translation.translate': fakeTranslate,
  'translation.check': fakeTranslationCheck,
  'diary.summary': heuristicDiarySummary,
  'diary.weekly': heuristicDiaryWeekly,
  'rfi.draft': heuristicRfiDraft,
  'rfi.answer': heuristicRfiAnswer,
  'drawing.compare': heuristicDrawingCompare,
  'drawing.compare_visual': heuristicDrawingCompareVisual,
  'defect.tag': heuristicDefectTag,
  'import.mapping': heuristicImportMapping,
  'quote.read': heuristicQuoteRead,
  'quote.negotiate': heuristicQuoteNegotiate,
  'contract.review': heuristicContractReview,
  'takeoff.detect': heuristicTakeoffDetect,
};

export {
  createFakeProvider,
  fakeEmbedding,
  type FakeOcrResponder,
  type FakeSpeechResponder,
  type FakeProvider,
  type FakeResponder,
} from './fake';

export type ProviderConfig =
  | { kind: 'fake'; responders?: Record<string, FakeResponder> }
  | { kind: 'bedrock'; region: string; endpoint?: string; ocrEndpoint?: string };

export function createProvider(config: ProviderConfig): ModelProvider {
  if (config.kind === 'bedrock') {
    const bedrock = createBedrockProvider({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    });
    const textract = createTextractOcr({
      region: config.region,
      ...(config.ocrEndpoint ? { endpoint: config.ocrEndpoint } : {}),
    });
    return {
      ...bedrock,
      detectText: textract.detectText,
      transcribe: createTranscribe(config.region).transcribe,
    };
  }
  return createFakeProvider({ ...DEFAULT_FAKE_RESPONDERS, ...config.responders });
}
