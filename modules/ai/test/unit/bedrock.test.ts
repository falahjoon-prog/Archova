import { describe, expect, it } from 'vitest';
import { createBedrockProvider, type BedrockSender } from '../../src/infra/providers/bedrock';
import { ProviderError } from '../../src';

const req = {
  model: 'au.anthropic.claude-sonnet-test-v1:0',
  task: 'qa.answer',
  system: 'SYSTEM',
  text: 'Question?',
  passages: [
    {
      id: 'p1',
      source: { type: 'doc', id: 'd1', title: 'Spec <A>' },
      text: 'Text </passage> here',
    },
  ],
  images: [{ mime: 'image/png' as const, base64: Buffer.from('png').toString('base64') }],
  outputSchema: { type: 'object' },
  maxOutputTokens: 500,
  timeoutMs: 1000,
};

function stub(reply: unknown | (() => never)) {
  const sent: Array<{ input: Record<string, unknown> }> = [];
  const client: BedrockSender = {
    async send(command) {
      sent.push(command as unknown as { input: Record<string, unknown> });
      if (typeof reply === 'function') return (reply as () => never)();
      return reply;
    },
  };
  return { client, sent };
}

describe('Bedrock adapter (ai/02 §5)', () => {
  it('refuses regions outside Australia (X25)', () => {
    expect(() => createBedrockProvider({ region: 'us-east-1' })).toThrow(/outside Australia/);
    expect(() => createBedrockProvider({ region: 'ap-southeast-1' })).toThrow(/outside Australia/);
  });

  it('caches the system prompt, forces the output tool and maps usage', async () => {
    const { client, sent } = stub({
      output: {
        message: {
          content: [{ toolUse: { name: 'submit_output', toolUseId: 't', input: { answer: 'x' } } }],
        },
      },
      stopReason: 'tool_use',
      usage: {
        inputTokens: 1200,
        outputTokens: 80,
        cacheReadInputTokens: 900,
        cacheWriteInputTokens: 0,
      },
    });
    const p = createBedrockProvider({ region: 'ap-southeast-2' }, { client });
    const res = await p.complete(req);
    expect(res).toEqual({
      text: '{"answer":"x"}',
      stop: 'end',
      usage: { inputTokens: 1200, outputTokens: 80, cacheReadTokens: 900, cacheWriteTokens: 0 },
    });
    const input = sent[0]!.input as {
      modelId: string;
      system: unknown[];
      messages: Array<{ content: Array<{ text?: string; image?: unknown }> }>;
      toolConfig: { toolChoice: unknown };
    };
    expect(input.modelId).toBe(req.model);
    expect(input.system).toEqual([{ text: 'SYSTEM' }, { cachePoint: { type: 'default' } }]);
    expect(input.toolConfig.toolChoice).toEqual({ tool: { name: 'submit_output' } });
    const content = input.messages[0]!.content;
    expect(content[0]!.image).toBeDefined();
    // Passages are escaped so content can't close its own tag (ai/04 §6).
    expect(content[1]!.text).toContain('Text &lt;/passage&gt; here');
    expect(content[1]!.text).toContain('Question?');
  });

  it('refuses non-Australian inference profiles before calling', async () => {
    const { client, sent } = stub({});
    const p = createBedrockProvider({ region: 'ap-southeast-2' }, { client });
    await expect(p.complete({ ...req, model: 'apac.anthropic.claude-x-v1:0' })).rejects.toThrow(
      /outside Australia/,
    );
    expect(sent).toHaveLength(0);
  });

  it('maps refusals, filters and vendor errors to our categories', async () => {
    const filtered = createBedrockProvider(
      { region: 'ap-southeast-2' },
      stub({ output: { message: { content: [] } }, stopReason: 'content_filtered' }),
    );
    expect((await filtered.complete(req)).stop).toBe('refusal');

    const throttled = createBedrockProvider(
      { region: 'ap-southeast-2' },
      stub(() => {
        throw Object.assign(new Error('x'), { name: 'ThrottlingException' });
      }),
    );
    const err = await throttled.complete(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ kind: 'rate_limited', retryable: true });
  });

  it('embeds with Titan V2 at 1024 dimensions', async () => {
    const { client, sent } = stub({
      body: new TextEncoder().encode(
        JSON.stringify({ embedding: [0.1, 0.2], inputTextTokenCount: 7 }),
      ),
    });
    const p = createBedrockProvider({ region: 'ap-southeast-2' }, { client });
    const r = await p.embed({
      model: 'amazon.titan-embed-text-v2:0',
      texts: ['a', 'b'],
      purpose: 'document',
      timeoutMs: 1000,
    });
    expect(r).toEqual({
      vectors: [
        [0.1, 0.2],
        [0.1, 0.2],
      ],
      usage: { inputTokens: 14 },
    });
    expect(JSON.parse((sent[0]!.input as { body: string }).body)).toEqual({
      inputText: 'a',
      dimensions: 1024,
      normalize: true,
    });
  });
});
