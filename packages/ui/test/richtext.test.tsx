// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RichText, docFromElement, fillElement, docText, type RichDoc } from '../src';

const html = (s: string) => {
  const el = document.createElement('div');
  el.innerHTML = s;
  return el;
};

describe('docFromElement', () => {
  it('reads paragraphs, styles, colour, alignment and lists', () => {
    const doc = docFromElement(
      html(
        'Loose <b>bold</b><div style="text-align:center"><i>mid</i></div>' +
          '<div><font color="#B42318"><u>red</u></font></div><ul><li>one</li><li>two <b>b</b></li></ul>',
      ),
    );
    expect(doc.blocks[0]).toEqual({
      type: 'paragraph',
      align: 'left',
      lines: [[{ text: 'Loose ' }, { text: 'bold', bold: true }]],
    });
    expect(doc.blocks[1]).toMatchObject({
      align: 'center',
      lines: [[{ text: 'mid', italic: true }]],
    });
    expect(doc.blocks[2]?.lines[0]).toEqual([{ text: 'red', underline: true, colour: 'red' }]);
    expect(doc.blocks[3]).toMatchObject({ type: 'bullet_list' });
    expect(doc.blocks[3]?.lines).toHaveLength(2);
  });

  it('drops markup, scripts and unknown colours instead of keeping them', () => {
    const doc = docFromElement(
      html(
        '<div><img src=x onerror="alert(1)"><span style="color:#123456">plain</span> &lt;b&gt;</div>',
      ),
    );
    expect(JSON.stringify(doc)).not.toContain('onerror');
    expect(doc.blocks[0]?.lines[0]).toEqual([{ text: 'plain <b>' }]);
  });
});

describe('fillElement and RichText', () => {
  const doc: RichDoc = {
    blocks: [
      { type: 'paragraph', align: 'right', lines: [[{ text: '<script>x</script>', bold: true }]] },
      { type: 'ordered_list', lines: [[{ text: 'a' }], [{ text: 'b', colour: 'green' }]] },
    ],
  };
  it('round-trips through the editor element', () => {
    const el = document.createElement('div');
    fillElement(el, doc);
    expect(el.querySelector('script')).toBeNull();
    expect(docText(docFromElement(el))).toBe('<script>x</script>\na\nb');
  });
  it('shows text as text, never as markup', () => {
    const { container } = render(<RichText doc={doc} />);
    expect(screen.getByText('<script>x</script>')).toBeTruthy();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('ol')?.children).toHaveLength(2);
  });
});
