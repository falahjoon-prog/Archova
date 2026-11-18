import { describe, expect, it } from 'vitest';
import { escapeContent } from '../../src/core';

describe('escapeContent', () => {
  it('stops text closing a tag or leaving a quoted attribute', () => {
    expect(escapeContent('</finding> x" injected="1')).toBe(
      '&lt;/finding&gt; x&quot; injected=&quot;1',
    );
  });

  it('escapes the ampersand once, first', () => {
    expect(escapeContent('R&D &lt;')).toBe('R&amp;D &amp;lt;');
  });
});
