// Minimal, valid one-page PDFs for synthetic drawings and documents: a border, a title block with the sheet number,
// title and revision, and a few lines of body text. No dependencies; pdf.js (the drawing register) reads the text.

const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);

export function makePdf(opts: {
  project: string;
  number: string;
  title: string;
  rev: string;
  lines?: string[];
}): Uint8Array {
  const W = 1191; // A3 landscape, points
  const H = 842;
  const text = (x: number, y: number, size: number, s: string) =>
    `BT /F1 ${size} Tf ${x} ${y} Td (${esc(s)}) Tj ET`;
  const content = [
    '1 w 20 20 m 1171 20 l 1171 822 l 20 822 l h S', // border
    '871 20 m 871 160 l 1171 160 l S', // title block
    text(885, 135, 10, 'HARBOUR LINE CONSTRUCTIONS (SAMPLE DATA)'),
    text(885, 115, 11, opts.project),
    text(885, 88, 14, opts.title),
    text(885, 55, 22, opts.number),
    text(1095, 55, 14, `REV ${opts.rev}`),
    text(885, 32, 8, 'Synthetic demo drawing. Not for construction.'),
    text(1095, 115, 9, 'SCALE 1:100 @ A3'), // Felix's Measure tool reads the scale from the title block
    // A simple vector floor plan: outer walls, two internal walls and a door opening.
    '2 w 80 200 m 820 200 l 820 700 l 80 700 l h S',
    '1.5 w 400 200 m 400 420 l S 400 480 m 400 700 l S 400 450 m 820 450 l S',
    ...(opts.lines ?? []).map((l, i) => text(60, 760 - i * 22, 12, l)),
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}
