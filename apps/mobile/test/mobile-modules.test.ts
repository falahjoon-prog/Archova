import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@archova/api-client';
import { mobileRoutes } from '@archova/routes';
import { TOOLS } from '../lib/tools';
import { withPage } from '../lib/files/open-file';
import { documentSubtitle, folderRows } from '../features/documents';
import { byDivision, pageText, sectionTitle } from '../features/specifications';
import { submittalSubtitle, waitingStep, respondToStep } from '../features/submittals';
import { assignmentSummary, shiftTitle } from '../features/crews';
import {
  dayWindow,
  defaultRange,
  timesheetFlags,
  type CheckSession,
  type CheckShift,
  rejectTimesheet,
} from '../features/timesheets';

vi.mock('../features/documents/screens/DocumentsScreen', () => ({}));
vi.mock('../features/documents/screens/DocumentScreen', () => ({}));
vi.mock('../features/specifications/screens/SpecificationsScreen', () => ({}));
vi.mock('../features/specifications/screens/SpecBookScreen', () => ({}));
vi.mock('../features/submittals/screens/SubmittalsScreen', () => ({}));
vi.mock('../features/submittals/screens/SubmittalScreen', () => ({}));
vi.mock('../features/timesheets/screens/TimesheetsScreen', () => ({}));
vi.mock('../features/timesheets/screens/TimesheetScreen', () => ({}));
vi.mock('../features/crews/screens/CrewsScreen', () => ({}));
vi.mock('expo-web-browser', () => ({ openBrowserAsync: vi.fn() }));

describe('tools and routes', () => {
  it('lists a tile for each new module', () => {
    const ids = TOOLS.map((t) => t.id);
    for (const id of ['documents', 'specifications', 'submittals', 'timesheets', 'crews'])
      expect(ids).toContain(id);
  });
  it('builds the routes', () => {
    expect(mobileRoutes.document('p', 'd')).toBe('/project/p/documents/d');
    expect(mobileRoutes.specBook('p', 'b')).toBe('/project/p/specifications/b');
    expect(mobileRoutes.submittal('p', 's')).toBe('/project/p/submittals/s');
    expect(mobileRoutes.timesheet('p', 't')).toBe('/project/p/timesheets/t');
    expect(mobileRoutes.crews('p')).toBe('/project/p/crews');
  });
});

describe('documents and specs text', () => {
  it('opens a PDF at a page', () => {
    expect(withPage('https://x/y.pdf#page=2', 7)).toBe('https://x/y.pdf#page=7');
    expect(withPage('https://x/y.pdf')).toBe('https://x/y.pdf');
  });
  it('summarises a document', () => {
    expect(
      documentSubtitle({
        docNumber: 'A-01',
        discipline: 'Architectural',
        status: 'for_construction',
        currentRevision: { rev: 'C' },
      }),
    ).toBe('A-01, Rev C, For construction, Architectural');
  });
  it('orders folders parents first and indents children', () => {
    const rows = folderRows([
      { id: 'c', parentId: 'a', name: 'Child' },
      { id: 'b', parentId: null, name: 'B' },
      { id: 'a', parentId: null, name: 'A' },
    ]);
    expect(rows.map((r) => [r.folder.id, r.depth])).toEqual([
      ['a', 0],
      ['c', 1],
      ['b', 0],
    ]);
  });
  it('words sections and groups by division', () => {
    expect(pageText({ pageFrom: 4, pageTo: 4 })).toBe('Page 4');
    expect(pageText({ pageFrom: 4, pageTo: 9 })).toBe('Pages 4 to 9');
    expect(sectionTitle({ sectionNumber: '03 30 00', title: 'Concrete' })).toBe(
      '03 30 00  Concrete',
    );
    expect(
      byDivision([{ division: '03' }, { division: '03' }, { division: null }]).map(
        (g) => g.sections.length,
      ),
    ).toEqual([2, 1]);
  });
});

describe('submittals', () => {
  it('describes who has the ball', () => {
    expect(
      submittalSubtitle({
        numberLabel: 'SD-014',
        type: 'shop_drawing',
        status: 'in_review',
        ballInCourt: { side: 'consultant' },
        submitByState: 'none',
      }),
    ).toBe('SD-014, Shop drawing, In review, with the consultant');
  });
  it('finds the pending step the ball points at', () => {
    const revisions = [
      {
        steps: [
          { id: 's1', response: 'pending' },
          { id: 's2', response: 'approved' },
        ],
      },
    ];
    expect(waitingStep(revisions, { stepId: 's1' })?.id).toBe('s1');
    expect(waitingStep(revisions, { stepId: 's2' })).toBeNull();
    expect(waitingStep(revisions, { stepId: null })).toBeNull();
  });
  it('sends only non-empty comments', async () => {
    const POST = vi.fn().mockResolvedValue({ data: {}, response: { ok: true } });
    await respondToStep(
      { POST } as unknown as ApiClient,
      { orgId: 'o', projectId: 'p' },
      {
        submittalId: 's',
        stepId: 'st',
        response: 'approved',
        comments: '  ',
      },
    );
    expect(POST.mock.calls[0]![1].body).toEqual({ response: 'approved' });
  });
});

describe('timesheet check', () => {
  const sheet = { workerId: 'w1', paidMinutes: 480 };
  const session = (minutes: number | null, status = 'off_site'): CheckSession => ({
    workerId: 'w1',
    minutes,
    status,
  });
  const shift = (status = 'accepted', shiftStatus = 'published'): CheckShift => ({
    status: shiftStatus,
    startsAt: '2026-11-09T21:00:00Z',
    assignments: [{ workerId: 'w1', status }],
  });
  it('is quiet when hours match sign-ins and roster', () => {
    expect(timesheetFlags(sheet, [session(480)], [shift()])).toEqual([]);
  });
  it('allows a small tolerance', () => {
    expect(timesheetFlags(sheet, [session(470)], [shift()])).toEqual([]);
  });
  it('flags hours with no sign-in', () => {
    expect(timesheetFlags(sheet, [], [shift()]).map((f) => f.code)).toEqual(['no_sign_in']);
  });
  it('flags more paid than signed in', () => {
    expect(timesheetFlags(sheet, [session(400)], [shift()]).map((f) => f.code)).toEqual([
      'more_than_signed_in',
    ]);
  });
  it('flags auto-closed and open sessions', () => {
    expect(
      timesheetFlags(sheet, [session(480, 'auto_closed')], [shift()]).map((f) => f.code),
    ).toEqual(['auto_closed']);
    expect(timesheetFlags(sheet, [session(null)], [shift()]).map((f) => f.code)).toContain(
      'open_session',
    );
  });
  it('flags a worker who is not on a published roster shift, or declined it', () => {
    expect(timesheetFlags(sheet, [session(480)], []).map((f) => f.code)).toEqual(['not_on_roster']);
    expect(timesheetFlags(sheet, [session(480)], [shift('declined')]).map((f) => f.code)).toEqual([
      'not_on_roster',
    ]);
    expect(
      timesheetFlags(sheet, [session(480)], [shift('accepted', 'draft')]).map((f) => f.code),
    ).toEqual(['not_on_roster']);
  });
  it('ignores other workers and empty sheets', () => {
    expect(
      timesheetFlags(sheet, [{ workerId: 'w2', minutes: 480, status: 'off_site' }], [shift()]).map(
        (f) => f.code,
      ),
    ).toEqual(['no_sign_in']);
    expect(timesheetFlags({ workerId: 'w1', paidMinutes: 0 }, [], [])).toEqual([]);
  });
  it('uses a two week range and the local day window', () => {
    expect(defaultRange('2026-11-14')).toEqual({ from: '2026-11-01', to: '2026-11-14' });
    expect(dayWindow('2026-11-09', 'Australia/Sydney')).toEqual({
      from: '2026-11-08T13:00:00.000Z',
      to: '2026-11-09T13:00:00.000Z',
    });
  });
  it('trims the rejection reason', async () => {
    const POST = vi.fn().mockResolvedValue({ data: {}, response: { ok: true } });
    await rejectTimesheet(
      { POST } as unknown as ApiClient,
      { orgId: 'o', projectId: 'p' },
      't',
      ' wrong day ',
    );
    expect(POST.mock.calls[0]![1].body).toEqual({ reason: 'wrong day' });
  });
});

describe('crews', () => {
  it('titles a shift and counts answers', () => {
    expect(shiftTitle({ crew: 'Crew A', trade: 'Formwork' })).toBe('Crew A, Formwork');
    expect(shiftTitle({ crew: null, trade: 'Formwork' })).toBe('Formwork');
    expect(
      assignmentSummary([{ status: 'accepted' }, { status: 'accepted' }, { status: 'offered' }]),
    ).toBe('2 accepted, 1 offered');
  });
});
