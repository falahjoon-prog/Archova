import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import type { TitleBlockOutput } from '@archova/ai-prompts';
import {
  compareRevisions,
  matchToRegister,
  reviewTitleBlock,
  selectTitleBlockText,
  toLines,
} from '../../src/domain/titleblock';
import { readPdfText } from '../../src/infra/pdf';
import { runSuite } from '../../src/eval/harness';
import {
  drawingTitleBlockSuite,
  heuristicTitleBlock,
} from '../../src/eval/suites/drawing-titleblock';
import { createFakeProvider } from '../../src';
import { routing } from './fixtures';

const field = (value: string | null, quote: string | null, confidence = 0.95) => ({
  value,
  quote,
  confidence,
});
const output = (over: Partial<TitleBlockOutput['fields']> = {}): TitleBlockOutput => ({
  isDrawing: true,
  fields: {
    number: field('A-201', 'DRAWING No.  A-201'),
    title: field('Level 3 Floor Plan', 'LEVEL 3 FLOOR PLAN'),
    revision: field('C', 'REV  C'),
    discipline: { ...field(null, null), value: 'architectural', confidence: 0.9 },
    revisionDate: field('2026-04-03', '03/04/2026'),
    scale: field('1:100 @ A1', 'SCALE  1:100 @ A1'),
    ...over,
  },
});
const sheet = [
  'DRAWING TITLE',
  'LEVEL 3 FLOOR PLAN',
  'SCALE  1:100 @ A1',
  'DATE  03/04/2026',
  'DRAWING No.  A-201    REV  C',
].join('\n');

describe('title block region (ai/05 L3)', () => {
  it('keeps the bottom-right corner and right strip, in reading order', () => {
    const page = { width: 1000, height: 700 };
    const items = [
      { str: 'GENERAL NOTES', x: 50, y: 650, height: 10 },
      { str: 'REV C', x: 900, y: 40, height: 8 },
      { str: 'DRAWING No. A-201', x: 700, y: 40, height: 8 },
      { str: 'LEVEL 3 FLOOR PLAN', x: 700, y: 80, height: 10 },
      { str: 'CONSULTANT', x: 850, y: 600, height: 8 },
    ];
    expect(selectTitleBlockText(items, page)).toBe(
      'CONSULTANT\nLEVEL 3 FLOOR PLAN\nDRAWING No. A-201  REV C',
    );
    // Too little in the region: fall back to the whole sheet.
    expect(selectTitleBlockText(items.slice(0, 1), page)).toBe('GENERAL NOTES');
    expect(toLines([])).toEqual([]);
  });
});

describe('field checks (ai/01 §4 F1: never silently filled)', () => {
  it('accepts fields quoted from the sheet and flags low confidence', () => {
    const r = reviewTitleBlock(
      output({ scale: field('1:100 @ A1', 'SCALE  1:100 @ A1', 0.6) }),
      sheet,
    );
    expect(r.flagged).toEqual(['scale']);
    expect(r.fields.number).toEqual({
      value: 'A-201',
      confidence: 0.95,
      flagged: false,
      reason: null,
    });
    expect(r.fields.scale.reason).toBe('low_confidence');
    expect(r.confidence).toBe(0.6);
  });

  it('flags values whose quote is not on the sheet, or not in the quote', () => {
    const r = reviewTitleBlock(
      output({
        revision: field('D', 'REV  D'),
        number: field('A-202', 'DRAWING No.  A-201'),
      }),
      sheet,
    );
    expect(r.flagged).toEqual(['number', 'revision']);
    expect(r.fields.revision).toMatchObject({ confidence: 0.3, reason: 'not_on_sheet' });
  });

  it('flags required fields that are missing on a drawing', () => {
    const r = reviewTitleBlock(output({ revision: field(null, null, 0) }), sheet);
    expect(r.fields.revision).toMatchObject({ flagged: true, reason: 'missing' });
  });
});

describe('register matching', () => {
  it('compares revisions within a scheme and leaves mixed schemes to a person', () => {
    expect(compareRevisions('C', 'B')).toBe(1);
    expect(compareRevisions('AA', 'Z')).toBe(1);
    expect(compareRevisions('2', '10')).toBe(-1);
    expect(compareRevisions('P2', 'p2')).toBe(0);
    expect(compareRevisions('A', 'P3')).toBeNull();
    expect(compareRevisions('T1', 'C')).toBeNull();
  });

  it('finds new drawings, new revisions and stale uploads', () => {
    const register = [{ number: 'A-201', revision: 'B' }];
    expect(matchToRegister({ number: 'A202', revision: 'A' }, register)).toEqual({
      action: 'new_drawing',
    });
    expect(matchToRegister({ number: 'a 201', revision: 'C' }, register)).toEqual({
      action: 'new_revision',
      supersedes: 'B',
    });
    expect(matchToRegister({ number: 'A-201', revision: 'B' }, register)).toEqual({
      action: 'same_revision',
    });
    expect(matchToRegister({ number: 'A-201', revision: 'A' }, register)).toEqual({
      action: 'older_revision',
      current: 'B',
    });
    expect(matchToRegister({ number: 'A-201', revision: null }, register)).toEqual({
      action: 'check_revision',
      current: 'B',
    });
  });
});

describe('PDF text layer', () => {
  it('reads positioned text per page', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const n of ['A-101', 'A-102']) {
      const page = doc.addPage([1189, 841]);
      page.drawText(`DRAWING No. ${n}`, { x: 1000, y: 60, size: 10, font });
      page.drawText('REV B', { x: 1100, y: 60, size: 10, font });
    }
    doc.addPage([1189, 841]); // a scan: no text
    const pdf = await readPdfText(await doc.save());
    expect(pdf.pageCount).toBe(3);
    const text = pdf.pages.map((p) => selectTitleBlockText(p.items, p).replace(/\s+/g, ' '));
    expect(text).toEqual(['DRAWING No. A-101 REV B', 'DRAWING No. A-102 REV B', '']);
  });
});

describe('F1 eval suite', () => {
  it('generates a stable synthetic golden set and passes its safety bars with the CI stand-in', async () => {
    expect(drawingTitleBlockSuite.cases.length).toBe(122);
    expect(new Set(drawingTitleBlockSuite.cases.map((c) => c.id)).size).toBe(122);
    const provider = createFakeProvider({ 'drawing.titleblock': heuristicTitleBlock });
    const report = await runSuite(drawingTitleBlockSuite, { provider, routing, gate: 'safety' });
    expect(report.passed).toBe(true);
    expect(report.schemaValidRate).toBe(1);
    expect(report.metrics.find((m) => m.metric === 'injection_ignored')?.mean).toBe(1);
  });
});
