import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_EVENT_TYPES,
  RECORD_EVENT_TYPES,
  documentSourceOf,
  recordKindOf,
} from '../../src';

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

describe('documentSourceOf', () => {
  const event = (type: string, entityId: string, data: unknown = {}) => ({ type, entityId, data });

  it('names the document a document event is about, and the sheet (not the revision) of a publish', () => {
    expect(documentSourceOf(event('documents.document.updated.v1', 'doc-1'))).toBe('doc-1');
    expect(documentSourceOf(event('documents.document.revision.added.v1', 'doc-2'))).toBe('doc-2');
    expect(
      documentSourceOf(
        event('documents.drawing.revision.published.v1', 'rev-9', { sheetId: 'sheet-4' }),
      ),
    ).toBe('sheet-4');
  });

  it('says nothing for a publish with no sheet, and for any other event', () => {
    expect(documentSourceOf(event('documents.drawing.revision.published.v1', 'rev-9'))).toBeNull();
    expect(
      documentSourceOf(event('documents.drawing.revision.published.v1', 'rev-9', null)),
    ).toBeNull();
    expect(
      documentSourceOf(event('documents.drawing.revision.published.v1', 'rev-9', { sheetId: 7 })),
    ).toBeNull();
    expect(documentSourceOf(event('documents.document.created.v1', 'doc-1'))).toBeNull();
    expect(documentSourceOf(event('documents.folder.updated.v1', 'fld-1'))).toBeNull();
  });

  it('lists exactly the events it can name a source for', () => {
    for (const type of DOCUMENT_EVENT_TYPES)
      expect(documentSourceOf(event(type, 'x', { sheetId: 'x' }))).toBe('x');
    expect(DOCUMENT_EVENT_TYPES).toHaveLength(3);
  });
});
