// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { captureSheetImage, findSheetCanvas } from '../lib/sheet-image';

const viewer = () => {
  const root = document.createElement('div');
  root.innerHTML = '<div class="pdf-sheet"><canvas></canvas></div><svg><g id="overlay"></g></svg>';
  document.body.append(root);
  return root;
};

describe('sheet picture for Nova', () => {
  it('finds the sheet canvas from the overlay beside it', () => {
    const root = viewer();
    expect(findSheetCanvas(root.querySelector('#overlay'))).toBe(root.querySelector('canvas'));
    expect(findSheetCanvas(null)).toBeNull();
  });

  it('sends nothing when the sheet has not been drawn, so the server renders it where it can', async () => {
    const root = viewer();
    expect(await captureSheetImage(root.querySelector('#overlay'))).toBeNull();
    expect(await captureSheetImage(null)).toBeNull();
  });
});
