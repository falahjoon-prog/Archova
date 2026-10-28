import { describe, expect, it } from 'vitest';
import { CsvTooLarge, detectDelimiter, isBlankRecord, parseCsv } from '../../src/domain/csv';

describe('csv reader', () => {
  it('reads quoted cells, escaped quotes, embedded commas and newlines', () => {
    const text = 'No,Subject,Notes\r\n1,"Slab, level 2","He said ""no""\nand left"\r\n2,Plain,\r\n';
    expect(parseCsv(text, 100)).toEqual([
      ['No', 'Subject', 'Notes'],
      ['1', 'Slab, level 2', 'He said "no"\nand left'],
      ['2', 'Plain', ''],
    ]);
  });

  it('drops a byte order mark and a missing final newline, keeps blank lines as records', () => {
    expect(parseCsv('﻿a,b\n1,2\n\n3,4', 100)).toEqual([['a', 'b'], ['1', '2'], [''], ['3', '4']]);
    expect(isBlankRecord([''])).toBe(true);
    expect(isBlankRecord(['', ' '])).toBe(true);
    expect(isBlankRecord(['x'])).toBe(false);
  });

  it('detects semicolon and tab separated files from the first line', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(detectDelimiter('"a;b",c,d')).toBe(',');
    expect(parseCsv('a;b\n1;2', 10)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('stops a runaway file', () => {
    expect(() => parseCsv('a\nb\nc\nd', 2)).toThrow(CsvTooLarge);
  });
});
