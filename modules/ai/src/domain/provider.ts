// Our own provider-neutral request and response shapes (ai/02 §5). Nothing outside
// `infra/providers/` sees a vendor type; features ask for a task, never a model.
import type { PromptImage, PromptPassage } from '@archova/ai-prompts';

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const NO_USAGE: ModelUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

export interface ModelRequest {
  /** Provider model id from the routing table. */
  model: string;
  /** Task id, for logs and the fake provider. Never sent to the vendor. */
  task: string;
  /** Stable instructions, sent first and marked cacheable. */
  system: string;
  /** Per-request content. */
  text: string;
  passages: readonly PromptPassage[];
  images: readonly PromptImage[];
  /** JSON Schema the output must match; the gateway still validates it. */
  outputSchema: Record<string, unknown>;
  maxOutputTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

export type StopReason = 'end' | 'max_tokens' | 'refusal';

export interface ModelResponse {
  /** The output as JSON text. */
  text: string;
  stop: StopReason;
  usage: ModelUsage;
}

export interface EmbedRequest {
  model: string;
  texts: readonly string[];
  purpose: 'document' | 'query';
  timeoutMs: number;
}

export interface EmbedResponse {
  vectors: number[][];
  usage: Pick<ModelUsage, 'inputTokens'>;
}

/** One page image for OCR (ai/02: Textract in Sydney). Greyscale PNG, at most 10 MB and 10,000 px a side. */
export interface OcrRequest {
  image: Uint8Array;
  timeoutMs: number;
}

/** A line of text found on the image. `box` is in fractions of the image, origin top-left. */
export interface OcrLine {
  text: string;
  /** 0–1. */
  confidence: number;
  box: { left: number; top: number; width: number; height: number };
}

export interface OcrResponse {
  /** In reading order. */
  lines: OcrLine[];
}

/** A short spoken clip for speech to text (Nova listening): one question, not a recording of a meeting. */
export interface SpeechRequest {
  audio: Uint8Array;
  mimeType: string;
  /** BCP 47 language of the speaker; Australian English unless said otherwise. */
  language: string;
  timeoutMs: number;
}

export interface SpeechResponse {
  text: string;
}

/** Error categories every adapter maps vendor errors to (ai/02 §5). */
export type ProviderErrorKind =
  'rate_limited' | 'overloaded' | 'timeout' | 'unavailable' | 'invalid_request' | 'auth';

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }

  /** Worth one retry, then a fallback tier (ai/02 §4 "Fallbacks"). */
  get retryable(): boolean {
    return (
      this.kind === 'rate_limited' ||
      this.kind === 'overloaded' ||
      this.kind === 'timeout' ||
      this.kind === 'unavailable'
    );
  }
}

/** One implementation per provider: Bedrock and Textract in AU now, a fake for tests (ai/02 §5). */
export interface ModelProvider {
  /** `bedrock`, `fake`. Recorded on every `ai_requests` row. */
  readonly name: string;
  /** AWS region or equivalent; must be Australian (X25). */
  readonly region: string;
  complete(req: ModelRequest): Promise<ModelResponse>;
  embed(req: EmbedRequest): Promise<EmbedResponse>;
  /** Reads the text off a scanned page (OCR), for search and title blocks. */
  detectText(req: OcrRequest): Promise<OcrResponse>;
  /** Turns a short spoken clip into text (speech to text), in Australia (X25). */
  transcribe(req: SpeechRequest): Promise<SpeechResponse>;
}
