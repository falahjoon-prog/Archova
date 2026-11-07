import { describe, expect, it } from 'vitest';
import {
  BODY_MAX,
  SUBJECT_MAX,
  canTakePart,
  cleanBody,
  cleanSubject,
  previewOf,
} from '../../src/domain/conversations';

describe('conversation text rules', () => {
  it('tidies a subject and refuses an empty or over-long one', () => {
    expect(cleanSubject('  Pour   programme \n change ')).toBe('Pour programme change');
    expect(cleanSubject('   ')).toBeNull();
    expect(cleanSubject('x'.repeat(SUBJECT_MAX))).not.toBeNull();
    expect(cleanSubject('x'.repeat(SUBJECT_MAX + 1))).toBeNull();
  });

  it('keeps line breaks inside a body but trims the ends', () => {
    expect(cleanBody('\n  Line one\nLine two  \n')).toBe('Line one\nLine two');
    expect(cleanBody('')).toBeNull();
    expect(cleanBody('y'.repeat(BODY_MAX + 1))).toBeNull();
  });

  it('shortens a preview to one line with an ellipsis', () => {
    expect(previewOf('short\nmessage')).toBe('short message');
    const p = previewOf('word '.repeat(80), 40);
    expect(p.length).toBeLessThanOrEqual(40);
    expect(p.endsWith('…')).toBe(true);
  });

  it('keeps conversations to the project team', () => {
    expect(canTakePart('member')).toBe(true);
    expect(canTakePart('external')).toBe(false);
    expect(canTakePart('support')).toBe(false);
  });
});
