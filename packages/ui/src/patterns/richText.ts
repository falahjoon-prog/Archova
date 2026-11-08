// Rich text as data: paragraphs and lists of styled runs. Never HTML, so a stored document cannot carry markup.

export type RichColour = 'slate' | 'red' | 'green' | 'blue';
export interface RichRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  colour?: RichColour;
}
export interface RichBlock {
  type: 'paragraph' | 'bullet_list' | 'ordered_list';
  align?: 'left' | 'center' | 'right';
  lines: RichRun[][];
}
export interface RichDoc {
  blocks: RichBlock[];
}

export const RICH_COLOURS: Record<RichColour, string> = {
  slate: '#3f5b73',
  red: '#b42318',
  green: '#157a3d',
  blue: '#0b6a9e',
};

const MAX_BLOCKS = 200;
const MAX_LINES = 100;
const MAX_RUNS = 50;
const MAX_TEXT = 2000;

const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE']);

const hexOf = (value: string): string | null => {
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  const m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(v);
  if (!m) return null;
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
};

/** The palette colour closest to what the browser wrote, or none when it is the default text colour. */
function colourOf(value: string | null): RichColour | undefined {
  const hex = value ? hexOf(value) : null;
  if (!hex) return undefined;
  for (const [id, h] of Object.entries(RICH_COLOURS)) if (h === hex) return id as RichColour;
  return undefined;
}

interface Style {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  colour: RichColour | undefined;
}

function alignOf(el: Element): RichBlock['align'] {
  const a = (el as HTMLElement).style?.textAlign || el.getAttribute('align') || '';
  return a === 'center' || a === 'right' ? a : 'left';
}

function pushRun(lines: RichRun[][], text: string, st: Style) {
  if (!text) return;
  const line = lines[lines.length - 1] as RichRun[];
  const prev = line[line.length - 1];
  const same =
    prev &&
    !!prev.bold === st.bold &&
    !!prev.italic === st.italic &&
    !!prev.underline === st.underline &&
    prev.colour === st.colour;
  if (same && prev.text.length + text.length <= MAX_TEXT) {
    prev.text += text;
    return;
  }
  for (let i = 0; i < text.length; i += MAX_TEXT) {
    const run: RichRun = { text: text.slice(i, i + MAX_TEXT) };
    if (st.bold) run.bold = true;
    if (st.italic) run.italic = true;
    if (st.underline) run.underline = true;
    if (st.colour) run.colour = st.colour;
    line.push(run);
  }
}

function walk(node: Node, st: Style, lines: RichRun[][]) {
  if (node.nodeType === 3) {
    pushRun(
      lines,
      (node.textContent ?? '')
        .split('\u00a0')
        .join(' ')
        .replace(/[\r\n]+/g, ' '),
      st,
    );
    return;
  }
  if (node.nodeType !== 1) return;
  const el = node as HTMLElement;
  const tag = el.tagName;
  if (tag === 'BR') {
    lines.push([]);
    return;
  }
  const next: Style = { ...st };
  if (
    tag === 'B' ||
    tag === 'STRONG' ||
    el.style.fontWeight === 'bold' ||
    el.style.fontWeight === '700'
  )
    next.bold = true;
  if (tag === 'I' || tag === 'EM' || el.style.fontStyle === 'italic') next.italic = true;
  if (
    tag === 'U' ||
    el.style.textDecorationLine === 'underline' ||
    el.style.textDecoration === 'underline'
  )
    next.underline = true;
  const c = colourOf(el.getAttribute('color') ?? el.style.color);
  if (c) next.colour = c;
  const block = BLOCK_TAGS.has(tag);
  if (block && (lines[lines.length - 1] as RichRun[]).length > 0) lines.push([]);
  el.childNodes.forEach((child) => walk(child, next, lines));
  if (block && (lines[lines.length - 1] as RichRun[]).length > 0) lines.push([]);
}

const linesOf = (node: Node): RichRun[][] => {
  const lines: RichRun[][] = [[]];
  walk(node, { bold: false, italic: false, underline: false, colour: undefined }, lines);
  return lines
    .filter((l) => l.length > 0)
    .slice(0, MAX_LINES)
    .map((l) => l.slice(0, MAX_RUNS));
};

/** Reads what was typed in the editor into a document; anything outside paragraphs, lists and the styles above is dropped. */
export function docFromElement(root: HTMLElement): RichDoc {
  const blocks: RichBlock[] = [];
  let loose: ChildNode[] = [];
  const flushLoose = () => {
    const holder = root.ownerDocument.createElement('div');
    loose.forEach((n) => holder.appendChild(n.cloneNode(true)));
    for (const line of linesOf(holder))
      blocks.push({ type: 'paragraph', align: 'left', lines: [line] });
    loose = [];
  };
  root.childNodes.forEach((n) => {
    const tag = n.nodeType === 1 ? (n as Element).tagName : '';
    if (tag === 'UL' || tag === 'OL') {
      flushLoose();
      const items: RichRun[][] = [];
      (n as Element).querySelectorAll(':scope > li').forEach((li) => {
        const l = linesOf(li);
        if (l.length) items.push(l.flat());
      });
      if (items.length)
        blocks.push({
          type: tag === 'UL' ? 'bullet_list' : 'ordered_list',
          align: alignOf(n as Element),
          lines: items.slice(0, MAX_LINES),
        });
    } else if (BLOCK_TAGS.has(tag)) {
      flushLoose();
      const align = alignOf(n as Element);
      for (const line of linesOf(n)) blocks.push({ type: 'paragraph', align, lines: [line] });
    } else loose.push(n);
  });
  flushLoose();
  return { blocks: blocks.slice(0, MAX_BLOCKS) };
}

/** Builds editor content from a document using DOM calls only, so text is never parsed as markup. */
export function fillElement(root: HTMLElement, doc: RichDoc) {
  const d = root.ownerDocument;
  root.replaceChildren();
  const runNode = (r: RichRun): Node => {
    let n: Node = d.createTextNode(r.text);
    const wrap = (tag: string) => {
      const e = d.createElement(tag);
      e.appendChild(n);
      n = e;
    };
    if (r.bold) wrap('b');
    if (r.italic) wrap('i');
    if (r.underline) wrap('u');
    if (r.colour) {
      const f = d.createElement('font');
      f.setAttribute('color', RICH_COLOURS[r.colour]);
      f.appendChild(n);
      n = f;
    }
    return n;
  };
  for (const b of doc.blocks) {
    if (b.type === 'paragraph') {
      const p = d.createElement('div');
      if (b.align && b.align !== 'left') p.style.textAlign = b.align;
      (b.lines[0] ?? []).forEach((r) => p.appendChild(runNode(r)));
      if (!p.firstChild) p.appendChild(d.createElement('br'));
      root.appendChild(p);
    } else {
      const list = d.createElement(b.type === 'bullet_list' ? 'ul' : 'ol');
      if (b.align && b.align !== 'left') list.style.textAlign = b.align;
      for (const line of b.lines) {
        const li = d.createElement('li');
        line.forEach((r) => li.appendChild(runNode(r)));
        list.appendChild(li);
      }
      root.appendChild(list);
    }
  }
  if (!root.firstChild) root.appendChild(d.createElement('div')).appendChild(d.createElement('br'));
}

export const docText = (doc: RichDoc): string =>
  doc.blocks.map((b) => b.lines.map((l) => l.map((r) => r.text).join('')).join('\n')).join('\n');
