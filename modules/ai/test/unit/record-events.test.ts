import { describe, expect, it } from 'vitest';
import { RECORD_EVENT_TYPES, recordKindOf } from '../../src';

describe('recordKindOf', () => {
  it('names the record an RFI, defect or diary event is about', () => {
    expect(recordKindOf('rfis.rfi.responded.v1')).toBe('rfi');
    expect(recordKindOf('rfis.rfi.voided.v1')).toBe('rfi');
    expect(recordKindOf('defects.defect.created.v1')).toBe('defect');
    expect(recordKindOf('defects.defect.void.v1')).toBe('defect');
    expect(recordKindOf('diary.entry.saved.v1')).toBe('diary');
    expect(recordKindOf('diary.entry.amended.v1')).toBe('diary');
  });

  it('ignores every other event', () => {
    expect(recordKindOf('documents.document.created.v1')).toBeNull();
    expect(recordKindOf('diary.line.added.v1')).toBeNull();
    expect(recordKindOf('rfis.settings.changed.v1')).toBeNull();
  });

  it('has a subscription pattern for each kind', () => {
    for (const pattern of RECORD_EVENT_TYPES)
      expect(recordKindOf(pattern.replace('*', 'x.v1'))).not.toBeNull();
    expect(RECORD_EVENT_TYPES).toHaveLength(3);
  });
});
