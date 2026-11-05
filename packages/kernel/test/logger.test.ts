import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, scrubSecrets } from '../src/logger';

describe('scrubSecrets', () => {
  it('removes bearer tokens, personal access tokens and webhook secrets', () => {
    const text = 'GET /x Authorization: Bearer abc.def-123 pk_live_AbC_123-x whsec_QUJD+/=';
    const out = scrubSecrets(text);
    expect(out).not.toMatch(/abc\.def|AbC_123|QUJD/);
    expect(out).toContain('Bearer [redacted]');
    expect(out).toContain('pk_live_[redacted]');
    expect(out).toContain('whsec_[redacted]');
  });
  it('leaves ordinary text alone', () => {
    expect(scrubSecrets('Token expired for the Bearer of news')).toBe(
      'Token expired for the Bearer of news',
    );
  });
});

describe('createLogger', () => {
  it('scrubs tokens from messages, errors and nested fields, and redacts known keys', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _e, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const log = createLogger('t', 'info', sink);
    log.info(
      { req: { url: '/x?k=pk_live_Secret1', headers: { authorization: 'Bearer zzzzzzzz' } } },
      'got Bearer abc12345',
    );
    log.error({ err: new Error('bad pk_live_Secret2') }, 'failed');
    log.info({ hook: { secret: 'whsec_Zm9v', url: 'https://h.example/whsec_Zm9v' } }, 'made');
    const all = lines.join('');
    expect(all).not.toMatch(/Secret1|Secret2|abc12345|zzzzzzzz|Zm9v/);
    expect(all).toContain('[redacted]');
  });
});
