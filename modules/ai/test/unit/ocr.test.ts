import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { ocrPageText, ocrToTextItems } from '../../src/domain/ocr';
import { selectTitleBlockText } from '../../src/domain/titleblock';
import { ProviderError } from '../../src';
import { readScannedPages } from '../../src/infra/pdf';
import { createTextractOcr, type TextractSender } from '../../src/infra/providers/textract';
import { IMAGE_KIND, encodePng, ocrImage, toGrey } from '../../src/infra/raster';

const line = (text: string, left: number, top: number, confidence = 0.99) => ({
  text,
  confidence,
  box: { left, top, width: 0.1, height: 0.02 },
});

/** The size another PNG reader (pdf-lib) finds in a PNG we wrote. */
async function pngSize(png: Uint8Array) {
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(png);
  doc.addPage([img.width, img.height]).drawImage(img, { x: 0, y: 0 });
  return { width: img.width, height: img.height };
}

describe('OCR text (ai/03 §3 step 2)', () => {
  it('keeps reading order and drops low-confidence lines', () => {
    expect(
      ocrPageText([
        line('0712.4 HOT WATER', 0, 0),
        line('~~', 0.5, 0.5, 0.2),
        line(' 50 °C ', 0, 0.1),
      ]),
    ).toBe('0712.4 HOT WATER\n50 °C');
  });

  it('maps image boxes to page points, so the title block region is found as on a text layer', () => {
    // A full-page scan on an A1 sheet: the image's unit square is scaled to the page.
    const page = { width: 2384, height: 1684 };
    const items = ocrToTextItems(
      [
        line('NOTES', 0.03, 0.04),
        line('DRAWING No. A-201', 0.8, 0.9),
        line('REV C', 0.8, 0.93),
        line('SCALE 1:100', 0.8, 0.96),
      ],
      [page.width, 0, 0, page.height, 0, 0],
    );
    expect(items[1]).toEqual({
      str: 'DRAWING No. A-201',
      x: expect.closeTo(0.8 * 2384, 5),
      y: expect.closeTo((1 - 0.9 - 0.02) * 1684, 5),
      height: expect.closeTo(0.02 * 1684, 5),
    });
    expect(selectTitleBlockText(items, page)).toBe('DRAWING No. A-201\nREV C\nSCALE 1:100');
    // An image placed upside down (scanner flipped it) still lands on the page.
    const [flipped] = ocrToTextItems([line('X', 0, 0)], [-100, 0, 0, -50, 100, 50]);
    expect(flipped).toMatchObject({ x: 100, y: expect.closeTo(1, 5) });
  });
});

describe('page images for OCR', () => {
  it('greys and shrinks RGB, RGBA and 1-bit images by area average', () => {
    const rgb = {
      width: 4,
      height: 2,
      kind: IMAGE_KIND.RGB_24BPP,
      data: new Uint8Array(24).fill(255),
    };
    rgb.data.set([0, 0, 0, 0, 0, 0], 0); // two black pixels top left
    expect(toGrey(rgb, 2)).toEqual({ width: 2, height: 1, data: Uint8Array.from([128, 255]) });

    const rgba = {
      width: 1,
      height: 1,
      kind: IMAGE_KIND.RGBA_32BPP,
      data: Uint8Array.from([0, 0, 0, 0]),
    };
    expect(toGrey(rgba, 10).data[0]).toBe(255); // transparent is paper

    // 1-bit rows pad to whole bytes; a set bit is white.
    const bits = {
      width: 3,
      height: 2,
      kind: IMAGE_KIND.GRAYSCALE_1BPP,
      data: Uint8Array.from([0b10100000, 0b01000000]),
    };
    expect([...toGrey(bits, 10).data]).toEqual([255, 0, 255, 0, 255, 0]);
  });

  it('writes a PNG that readers accept, and stays under the size limit', async () => {
    const img = toGrey(
      { width: 30, height: 20, kind: IMAGE_KIND.RGB_24BPP, data: new Uint8Array(1800).fill(200) },
      100,
    );
    expect(await pngSize(encodePng(img))).toEqual({ width: 30, height: 20 });
    const big = {
      width: 6000,
      height: 10,
      kind: IMAGE_KIND.RGB_24BPP,
      data: new Uint8Array(180_000).fill(255),
    };
    const png = ocrImage(big)!;
    expect(Buffer.from(png).readUInt32BE(16)).toBe(5000); // longest side capped
  });

  it('finds the scanned image on pages with no text, and skips text and blank pages', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([600, 400]).drawText('Typed page', { x: 50, y: 300, font });
    const scan = await doc.embedPng(
      encodePng({ width: 300, height: 200, data: new Uint8Array(60_000).fill(255) }),
    );
    // A scan placed with a margin, like a scanner's "fit to page".
    doc.addPage([600, 400]).drawImage(scan, { x: 20, y: 10, width: 560, height: 380 });
    doc.addPage([600, 400]);
    // A logo is not a scan.
    doc.addPage([600, 400]).drawImage(scan, { x: 0, y: 0, width: 60, height: 40 });
    const bytes = await doc.save();

    const pages = await readScannedPages(bytes, [2, 3, 4, 9]);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ page: 2, width: 600, height: 400 });
    expect([...pages[0]!.placement]).toEqual([560, 0, 0, 380, 20, 10]);
    expect(Buffer.from(pages[0]!.png).readUInt32BE(16)).toBe(300);
    // The PDF is still readable afterwards (the document was closed cleanly).
    expect((await getDocument({ data: bytes, verbosity: 0 }).promise).numPages).toBe(4);
  });
});

describe('Textract adapter (ai/02)', () => {
  const stub = (reply: unknown) => {
    const sent: unknown[] = [];
    const client: TextractSender = {
      async send(command) {
        sent.push((command as unknown as { input: unknown }).input);
        if (reply instanceof Error) throw reply;
        return reply;
      },
    };
    return { client, sent };
  };

  it('refuses regions outside Australia (X25)', () => {
    expect(() => createTextractOcr({ region: 'us-east-1' })).toThrow(/outside Australia/);
  });

  it('sends the image bytes and returns lines only, with confidence as a fraction', async () => {
    const { client, sent } = stub({
      Blocks: [
        { BlockType: 'PAGE' },
        {
          BlockType: 'LINE',
          Text: 'REV C',
          Confidence: 97.5,
          Geometry: { BoundingBox: { Left: 0.8, Top: 0.9, Width: 0.05, Height: 0.01 } },
        },
        { BlockType: 'WORD', Text: 'REV', Confidence: 99 },
      ],
    });
    const ocr = createTextractOcr({ region: 'ap-southeast-2' }, { client });
    const image = Uint8Array.from([1, 2, 3]);
    expect(await ocr.detectText({ image, timeoutMs: 1000 })).toEqual({
      lines: [
        {
          text: 'REV C',
          confidence: 0.975,
          box: { left: 0.8, top: 0.9, width: 0.05, height: 0.01 },
        },
      ],
    });
    expect(sent).toEqual([{ Document: { Bytes: image } }]);
  });

  it('maps Textract errors to provider error kinds', async () => {
    const err = (name: string) => Object.assign(new Error(name), { name });
    for (const [name, kind] of [
      ['ProvisionedThroughputExceededException', 'rate_limited'],
      ['DocumentTooLargeException', 'invalid_request'],
      ['AccessDeniedException', 'auth'],
      ['Mystery', 'unavailable'],
    ] as const) {
      const ocr = createTextractOcr({ region: 'ap-southeast-4' }, stub(err(name)));
      await expect(ocr.detectText({ image: new Uint8Array(1), timeoutMs: 10 })).rejects.toEqual(
        new ProviderError(kind, `Textract ${name}`),
      );
    }
  });
});
