// Fake provider for tests, local development and CI evals: no network, deterministic, never leaves the process.
// Each task can register a responder; unknown tasks fail as an invalid request.
import type {
  EmbedRequest,
  EmbedResponse,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelUsage,
  OcrRequest,
  OcrResponse,
  StopReason,
} from '../../domain/provider';
import { ProviderError } from '../../domain/provider';

export type FakeReply =
  | { output: unknown; stop?: StopReason; usage?: Partial<ModelUsage> }
  | { text: string; stop?: StopReason; usage?: Partial<ModelUsage> };

export type FakeResponder = (req: ModelRequest) => FakeReply | Promise<FakeReply>;

/** Fake OCR: tests script what a page "says"; by default a scan reads as blank. */
export type FakeOcrResponder = (req: OcrRequest) => OcrResponse | Promise<OcrResponse>;

/** Rough token count (4 characters a token) so cost accounting has realistic numbers in tests. */
export const approxTokens = (text: string) => Math.ceil(text.length / 4);

export const FAKE_EMBEDDING_DIMENSIONS = 1024;

/**
 * Deterministic bag-of-words embedding: each word is hashed to a dimension, then the vector is L2-normalised.
 * Texts that share words get a high cosine similarity, which is enough to exercise retrieval in tests.
 */
export function fakeEmbedding(text: string, dims = FAKE_EMBEDDING_DIMENSIONS): number[] {
  const v = new Array<number>(dims).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    let h = 2166136261;
    for (let i = 0; i < word.length; i++) h = Math.imul(h ^ word.charCodeAt(i), 16777619);
    v[(h >>> 0) % dims]! += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export interface FakeProvider extends ModelProvider {
  /** Registers or replaces the responder for a task. */
  on(task: string, responder: FakeResponder): void;
  /** Registers or replaces the OCR responder. */
  onOcr(responder: FakeOcrResponder): void;
  /** Every request seen, newest last. */
  readonly calls: ModelRequest[];
  /** Every OCR request seen, newest last. */
  readonly ocrCalls: OcrRequest[];
}

export function createFakeProvider(
  responders: Record<string, FakeResponder> = {},
  opts: { region?: string } = {},
): FakeProvider {
  const table = new Map(Object.entries(responders));
  const calls: ModelRequest[] = [];
  const ocrCalls: OcrRequest[] = [];
  let ocr: FakeOcrResponder = () => ({ lines: [] });
  return {
    name: 'fake',
    region: opts.region ?? 'ap-southeast-2',
    calls,
    ocrCalls,
    on(task, responder) {
      table.set(task, responder);
    },
    onOcr(responder) {
      ocr = responder;
    },
    async complete(req: ModelRequest): Promise<ModelResponse> {
      calls.push(req);
      const responder = table.get(req.task);
      if (!responder)
        throw new ProviderError('invalid_request', `No fake responder for ${req.task}`);
      const reply = await responder(req);
      const text = 'text' in reply ? reply.text : JSON.stringify(reply.output);
      const prompt = req.system + req.text + req.passages.map((p) => p.text).join('');
      return {
        text,
        stop: reply.stop ?? 'end',
        usage: {
          inputTokens: approxTokens(prompt) + req.images.length * 1600,
          outputTokens: approxTokens(text),
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          ...reply.usage,
        },
      };
    },
    async embed(req: EmbedRequest): Promise<EmbedResponse> {
      return {
        vectors: req.texts.map((t) => fakeEmbedding(t)),
        usage: { inputTokens: req.texts.reduce((s, t) => s + approxTokens(t), 0) },
      };
    },
    async detectText(req: OcrRequest): Promise<OcrResponse> {
      ocrCalls.push(req);
      return ocr(req);
    },
  };
}
