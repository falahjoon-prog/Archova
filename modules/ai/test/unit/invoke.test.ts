import { describe, expect, it } from 'vitest';
import { invokePrompt } from '../../src/application/invoke';
import { ProviderError, createFakeProvider } from '../../src';
import { answerPrompt, passages, routing } from './fixtures';

const ok = {
  output: {
    answer: 'Membranes go 150 mm up the walls.',
    found: true,
    citations: [
      { passageId: 'p1', quote: 'extend 150 mm up walls' },
      { passageId: 'p7', quote: 'made up' },
    ],
  },
};
const opts = { passages, timeoutMs: 1000, allowFallback: true };

describe('invokePrompt (ai/03 steps 4–7)', () => {
  it('sends the cached system prompt, request and passages, validates and checks citations', async () => {
    const p = createFakeProvider({ 'qa.answer': () => ok });
    const r = await invokePrompt(p, routing, answerPrompt, { question: 'How high?' }, opts);
    expect(r.outcome).toMatchObject({ kind: 'ok', tier: 'standard', invalidCitations: 1 });
    if (r.outcome.kind !== 'ok') throw new Error();
    expect(r.outcome.citations).toEqual([
      expect.objectContaining({ passageId: 'p1', source: passages[0]!.source }),
    ]);
    expect(p.calls[0]).toMatchObject({
      model: 'fake-standard',
      system: answerPrompt.system,
      text: '<input>How high?</input>',
      passages,
      maxOutputTokens: 800,
    });
    expect(p.calls[0]!.outputSchema).toMatchObject({
      type: 'object',
      required: ['answer', 'found', 'citations'],
    });
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]).toMatchObject({ outcome: 'ok', attempt: 1 });
    expect(r.costMicros).toBeGreaterThan(0);
  });

  it('retries once on a rate limit, then succeeds on the same tier', async () => {
    let n = 0;
    const p = createFakeProvider({
      'qa.answer': () => {
        if (n++ === 0) throw new ProviderError('rate_limited', 'slow down');
        return ok;
      },
    });
    const r = await invokePrompt(p, routing, answerPrompt, { question: 'q' }, opts);
    expect(r.outcome.kind).toBe('ok');
    expect(r.calls.map((c) => [c.tier, c.outcome, c.errorKind])).toEqual([
      ['standard', 'error', 'rate_limited'],
      ['standard', 'ok', null],
    ]);
  });

  it('falls back to the fast tier for interactive work when the primary stays unavailable', async () => {
    const p = createFakeProvider({
      'qa.answer': (req) => {
        if (req.model === 'fake-standard') throw new ProviderError('overloaded', 'busy');
        return ok;
      },
    });
    const r = await invokePrompt(p, routing, answerPrompt, { question: 'q' }, opts);
    expect(r.outcome).toMatchObject({ kind: 'ok', tier: 'fast' });
    expect(r.calls.map((c) => c.outcome)).toEqual(['error', 'error', 'fallback']);
  });

  it('does not fall back for background work', async () => {
    const p = createFakeProvider({
      'qa.answer': () => {
        throw new ProviderError('unavailable', 'down');
      },
    });
    const r = await invokePrompt(
      p,
      routing,
      answerPrompt,
      { question: 'q' },
      {
        ...opts,
        allowFallback: false,
      },
    );
    expect(r.outcome).toMatchObject({ kind: 'failed' });
    expect(r.calls).toHaveLength(2);
  });

  it('retries output that breaks the schema, and gives up after both tiers', async () => {
    const p = createFakeProvider({ 'qa.answer': () => ({ text: 'Here you go: 150 mm' }) });
    const r = await invokePrompt(p, routing, answerPrompt, { question: 'q' }, opts);
    expect(r.outcome).toEqual({ kind: 'failed', lastError: null });
    expect(r.calls.map((c) => c.errorKind)).toEqual(Array(4).fill('invalid_output:not_json'));
  });

  it('stops at a refusal and at a non-retryable error', async () => {
    const refusing = createFakeProvider({ 'qa.answer': () => ({ text: '', stop: 'refusal' }) });
    const r1 = await invokePrompt(refusing, routing, answerPrompt, { question: 'q' }, opts);
    expect(r1.outcome).toEqual({ kind: 'refused' });
    expect(r1.calls).toHaveLength(1);

    const bad = createFakeProvider({
      'qa.answer': () => {
        throw new ProviderError('invalid_request', 'bad');
      },
    });
    const r2 = await invokePrompt(bad, routing, answerPrompt, { question: 'q' }, opts);
    expect(r2.outcome).toMatchObject({ kind: 'failed' });
    expect(r2.calls).toHaveLength(1);
  });

  it('reports cancellation when the caller aborts', async () => {
    const ac = new AbortController();
    const p = createFakeProvider({
      'qa.answer': () => {
        ac.abort();
        throw new ProviderError('timeout', 'aborted');
      },
    });
    const r = await invokePrompt(
      p,
      routing,
      answerPrompt,
      { question: 'q' },
      {
        ...opts,
        signal: ac.signal,
      },
    );
    expect(r.outcome).toEqual({ kind: 'cancelled' });
  });
});
