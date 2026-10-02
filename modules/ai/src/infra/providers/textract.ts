// Amazon Textract in Sydney for scanned pages (ai/02, ai/03 §3 step 2). The only file that imports the Textract SDK
// (X26, enforced by `pnpm check:boundaries`). Synchronous DetectDocumentText, one page image a call: pages are
// rendered by us, so nothing is staged in S3 and no async job outlives the request.
import {
  DetectDocumentTextCommand,
  TextractClient,
  type DetectDocumentTextCommandOutput,
} from '@aws-sdk/client-textract';
import type { OcrRequest, OcrResponse } from '../../domain/provider';
import { ProviderError } from '../../domain/provider';
import { isAustralianRegion } from '../../domain/routing';

export interface TextractConfig {
  region: string;
  /** Optional VPC endpoint URL (PrivateLink); credentials come from the task role. */
  endpoint?: string;
}

const ERROR_KINDS: Record<string, ProviderError['kind']> = {
  ThrottlingException: 'rate_limited',
  ProvisionedThroughputExceededException: 'rate_limited',
  LimitExceededException: 'rate_limited',
  InternalServerError: 'overloaded',
  InvalidParameterException: 'invalid_request',
  UnsupportedDocumentException: 'invalid_request',
  DocumentTooLargeException: 'invalid_request',
  BadDocumentException: 'invalid_request',
  AccessDeniedException: 'auth',
};

function toProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  const name = (e as { name?: string }).name ?? '';
  if (name === 'AbortError' || name === 'TimeoutError')
    return new ProviderError('timeout', 'Textract call timed out');
  return new ProviderError(ERROR_KINDS[name] ?? 'unavailable', `Textract ${name || 'error'}`);
}

/** The part of the SDK client we use; tests pass a stub so no network or credentials are needed. */
export interface TextractSender {
  send(command: DetectDocumentTextCommand, opts?: { abortSignal?: AbortSignal }): Promise<unknown>;
}

export function createTextractOcr(
  config: TextractConfig,
  opts: { client?: TextractSender } = {},
): { detectText(req: OcrRequest): Promise<OcrResponse> } {
  if (!isAustralianRegion(config.region)) {
    throw new Error(
      `Textract region ${config.region} is outside Australia; AI processing must stay in Australia (X25)`,
    );
  }
  const client: TextractSender =
    opts.client ??
    new TextractClient({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      maxAttempts: 1, // the gateway owns retries (ai/02 §4)
    });

  async function detectText(req: OcrRequest): Promise<OcrResponse> {
    let out: DetectDocumentTextCommandOutput;
    try {
      out = (await client.send(new DetectDocumentTextCommand({ Document: { Bytes: req.image } }), {
        abortSignal: AbortSignal.timeout(req.timeoutMs),
      })) as DetectDocumentTextCommandOutput;
    } catch (e) {
      throw toProviderError(e);
    }
    const lines = (out.Blocks ?? [])
      .filter((b) => b.BlockType === 'LINE' && b.Text)
      .map((b) => {
        const box = b.Geometry?.BoundingBox;
        return {
          text: b.Text!,
          confidence: (b.Confidence ?? 0) / 100,
          box: {
            left: box?.Left ?? 0,
            top: box?.Top ?? 0,
            width: box?.Width ?? 0,
            height: box?.Height ?? 0,
          },
        };
      });
    return { lines };
  }

  return { detectText };
}
