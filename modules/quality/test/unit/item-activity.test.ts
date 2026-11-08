import { describe, expect, it } from 'vitest';
import { countActivity, itemSuggestion, observationDraft } from '../../src/domain/item-activity';

describe('item activity', () => {
  it('counts each kind apart', () => {
    expect(
      countActivity([
        { kind: 'response', fileCount: 0 },
        { kind: 'comment', fileCount: 0 },
        { kind: 'photo', fileCount: 2 },
        { kind: 'attachment', fileCount: 1 },
        { kind: 'observation', fileCount: 0 },
      ]),
    ).toMatchObject({
      responseChanges: 1,
      comments: 1,
      photos: 2,
      attachments: 1,
      observations: 1,
    });
  });
  it('suggests an observation only for a failed item with a photo and none raised', () => {
    expect(itemSuggestion('fail', 1, 0)?.code).toBe('failed_with_photo');
    expect(itemSuggestion('fail', 0, 0)).toBeNull();
    expect(itemSuggestion('pass', 1, 0)).toBeNull();
    expect(itemSuggestion('fail', 1, 1)).toBeNull();
  });
  it('drafts a description from the item', () => {
    const d = observationDraft({
      inspectionLabel: 'INS-0001',
      itemPrompt: 'Areas clean',
      result: 'fail',
      comment: 'Rubbish',
    });
    expect(d).toContain('INS-0001');
    expect(d).toContain('Areas clean');
  });
});
