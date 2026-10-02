// Amazon Bedrock in Australia (ai/02 §3). The only file that imports the Bedrock SDK (X26, enforced by
// `pnpm check:boundaries`). Structured output uses a forced tool call whose input schema is the task's output
// schema; the gateway still validates it. Citations are our own (passage id + quote), not a vendor feature.
import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
  type ContentBlock,
  type ConverseCommandOutput,
  type SystemContentBlock,
} from '@aws-sdk/client-bedrock-runtime';
import { renderPassages } from '@archova/ai-prompts';
import type {
  EmbedRequest,
  EmbedResponse,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  StopReason,
} from '../../domain/provider';
import { ProviderError } from '../../domain/provider';
import { assertAustralianModelId, isAustralianRegion } from '../../domain/routing';

export interface BedrockConfig {
  region: string;
  /** Optional VPC endpoint URL (PrivateLink); credentials come from the task role. */
  endpoint?: string;
}

const OUTPUT_TOOL = 'submit_output';

const ERROR_KINDS: Record<string, ProviderError['kind']> = {
  ThrottlingException: 'rate_limited',
  ServiceQuotaExceededException: 'rate_limited',
  ServiceUnavailableException: 'unavailable',
  ModelNotReadyException: 'unavailable',
  InternalServerException: 'overloaded',
  ModelErrorException: 'overloaded',
  ModelTimeoutException: 'timeout',
  ValidationException: 'invalid_request',
  ResourceNotFoundException: 'invalid_request',
  AccessDeniedException: 'auth',
};

function toProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  const name = (e as { name?: string }).name ?? '';
  if (name === 'AbortError' || name === 'TimeoutError')
    return new ProviderError('timeout', 'Bedrock call timed out');
  return new ProviderError(ERROR_KINDS[name] ?? 'unavailable', `Bedrock ${name || 'error'}`);
}

function mapStop(reason: string | undefined): StopReason {
  if (reason === 'max_tokens' || reason === 'model_context_window_exceeded') return 'max_tokens';
  if (reason === 'content_filtered' || reason === 'guardrail_intervened' || reason === 'refusal')
    return 'refusal';
  return 'end';
}

const IMAGE_FORMAT = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' } as const;

/** The part of the SDK client we use; tests pass a stub so no network or credentials are needed. */
export interface BedrockSender {
  send(
    command: ConverseCommand | InvokeModelCommand,
    opts?: { abortSignal?: AbortSignal },
  ): Promise<unknown>;
}

export function createBedrockProvider(
  config: BedrockConfig,
  opts: { client?: BedrockSender } = {},
): ModelProvider {
  if (!isAustralianRegion(config.region)) {
    throw new Error(
      `Bedrock region ${config.region} is outside Australia; AI processing must stay in Australia (X25)`,
    );
  }
  const client: BedrockSender =
    opts.client ??
    new BedrockRuntimeClient({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      maxAttempts: 1, // the gateway owns retries and fallbacks (ai/02 §4)
    });

  async function complete(req: ModelRequest): Promise<ModelResponse> {
    assertAustralianModelId(req.model);
    // Stable prefix first and cached (ai/05 L2); untrusted passages and the request after it.
    const system: SystemContentBlock[] = [
      { text: req.system },
      { cachePoint: { type: 'default' } },
    ];
    const content: ContentBlock[] = [];
    for (const img of req.images) {
      content.push({
        image: {
          format: IMAGE_FORMAT[img.mime],
          source: { bytes: Buffer.from(img.base64, 'base64') },
        },
      });
    }
    const docs = req.passages.length ? `${renderPassages(req.passages)}\n\n` : '';
    content.push({ text: `${docs}${req.text}` });

    const signal = AbortSignal.any([
      AbortSignal.timeout(req.timeoutMs),
      ...(req.signal ? [req.signal] : []),
    ]);
    let out: ConverseCommandOutput;
    try {
      out = (await client.send(
        new ConverseCommand({
          modelId: req.model,
          system,
          messages: [{ role: 'user', content }],
          inferenceConfig: { maxTokens: req.maxOutputTokens },
          toolConfig: {
            tools: [
              {
                toolSpec: {
                  name: OUTPUT_TOOL,
                  description: 'Return the result. Always call this exactly once.',
                  inputSchema: { json: req.outputSchema as never },
                },
              },
            ],
            toolChoice: { tool: { name: OUTPUT_TOOL } },
          },
        }),
        { abortSignal: signal },
      )) as ConverseCommandOutput;
    } catch (e) {
      throw toProviderError(e);
    }
    const blocks = out.output?.message?.content ?? [];
    const tool = blocks.find((b) => b.toolUse?.name === OUTPUT_TOOL)?.toolUse;
    const text = tool ? JSON.stringify(tool.input) : blocks.map((b) => b.text ?? '').join('');
    return {
      text,
      stop: mapStop(out.stopReason),
      usage: {
        inputTokens: out.usage?.inputTokens ?? 0,
        outputTokens: out.usage?.outputTokens ?? 0,
        cacheReadTokens: out.usage?.cacheReadInputTokens ?? 0,
        cacheWriteTokens: out.usage?.cacheWriteInputTokens ?? 0,
      },
    };
  }

  async function invokeJson(modelId: string, body: unknown, timeoutMs: number) {
    try {
      const out = (await client.send(
        new InvokeModelCommand({
          modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify(body),
        }),
        { abortSignal: AbortSignal.timeout(timeoutMs) },
      )) as { body: Uint8Array };
      return JSON.parse(new TextDecoder().decode(out.body)) as Record<string, unknown>;
    } catch (e) {
      throw toProviderError(e);
    }
  }

  /** Titan Text Embeddings V2 and Cohere Embed, both served in Sydney (ai/02 §6). */
  async function embed(req: EmbedRequest): Promise<EmbedResponse> {
    assertAustralianModelId(req.model);
    if (req.model.includes('cohere.embed')) {
      const res = await invokeJson(
        req.model,
        {
          texts: req.texts,
          input_type: req.purpose === 'query' ? 'search_query' : 'search_document',
          truncate: 'END',
        },
        req.timeoutMs,
      );
      const vectors = res.embeddings as number[][];
      return {
        vectors,
        usage: { inputTokens: req.texts.reduce((s, t) => s + Math.ceil(t.length / 4), 0) },
      };
    }
    // Titan embeds one text per call.
    const vectors: number[][] = [];
    let inputTokens = 0;
    for (const text of req.texts) {
      const res = await invokeJson(
        req.model,
        { inputText: text, dimensions: 1024, normalize: true },
        req.timeoutMs,
      );
      vectors.push(res.embedding as number[]);
      inputTokens += Number(res.inputTextTokenCount ?? 0);
    }
    return { vectors, usage: { inputTokens } };
  }

  return { name: 'bedrock', region: config.region, complete, embed };
}
