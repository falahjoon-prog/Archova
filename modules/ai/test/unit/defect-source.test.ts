import { describe, expect, it } from 'vitest';
import { defectRevisionId, defectText, type DefectSource } from '../../src/domain/defect-source';

const DEFECT: DefectSource = {
  id: 'd1',
  number: 42,
  title: 'Cracked floor tile in ensuite',
  description: 'One tile is cracked across the corner by the shower waste.',
  status: 'ready_for_review',
  priority: 'high',
  stage: 'pre_pc',
  category: 'Finishes',
  trade: 'Tiling',
  assignee: 'Tilers R Us',
  dueDate: '2026-11-04',
  notes: [
    { action: 'reject', text: 'Still cracked at the corner.' },
    { action: 'markReadyForReview', text: 'Replaced and regrouted.' },
  ],
};

describe('defectText', () => {
  it('puts the number, title and where it stands first, then the description and the notes on its history', () => {
    expect(defectText(DEFECT)).toBe(
      [
        'DEF-0042: Cracked floor tile in ensuite',
        'Status: ready for review. Priority: high. Raised before practical completion. Trade: Tiling. Category: Finishes. Assigned to: Tilers R Us. Due: 2026-11-04.',
        'Description:\nOne tile is cracked across the corner by the shower waste.',
        'History:\n- Sent back: Still cracked at the corner.\n- Marked ready for review: Replaced and regrouted.',
      ].join('\n\n'),
    );
  });

  it('leaves out what a defect does not have', () => {
    const text = defectText({
      ...DEFECT,
      status: 'open',
      description: '  ',
      category: null,
      trade: null,
      assignee: null,
      dueDate: null,
      notes: [{ action: 'issue', text: '   ' }],
    });
    expect(text).toBe(
      [
        'DEF-0042: Cracked floor tile in ensuite',
        'Status: open. Priority: high. Raised before practical completion. Not assigned to a company.',
      ].join('\n\n'),
    );
  });

  it('names the stage and an action it does not know in plain words', () => {
    const text = defectText({
      ...DEFECT,
      stage: 'dlp',
      notes: [{ action: 'something_new', text: 'A note.' }],
    });
    expect(text).toContain('Raised in the defects liability period.');
    expect(text).toContain('- something_new: A note.');
  });
});

describe('defectRevisionId', () => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/;

  it('is a UUID that stays the same while the text does', () => {
    expect(defectRevisionId(DEFECT)).toMatch(uuid);
    expect(defectRevisionId({ ...DEFECT })).toBe(defectRevisionId(DEFECT));
  });

  it('changes when anything the text says changes', () => {
    const id = defectRevisionId(DEFECT);
    for (const change of [
      { status: 'closed' },
      { assignee: 'Other Tilers' },
      { dueDate: '2026-11-11' },
      { description: 'Two tiles are cracked.' },
      { notes: [...DEFECT.notes, { action: 'close', text: 'Checked on site.' }] },
    ] satisfies Partial<DefectSource>[])
      expect(defectRevisionId({ ...DEFECT, ...change }), JSON.stringify(change)).not.toBe(id);
  });

  it('differs between defects with the same words', () => {
    expect(defectRevisionId({ ...DEFECT, id: 'd2' })).not.toBe(defectRevisionId(DEFECT));
  });
});
