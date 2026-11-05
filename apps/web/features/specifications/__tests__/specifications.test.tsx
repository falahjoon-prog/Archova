// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, nav, renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

const { SpecificationsScreen } = await import('../screens/SpecificationsScreen');
const { parseSections, sectionsToText } = await import('../lib/sections');

const P = '/v1/orgs/{orgId}/projects/{projectId}/spec-books';
const book = (over = {}) => ({
  id: 'spb_00000000000000000000000001',
  projectId: 'prj_test',
  name: 'Architectural spec, Issue A',
  issuedDate: '2026-10-01',
  fileId: null,
  status: 'current',
  supersededById: null,
  sectionCount: 1,
  version: 2,
  ...over,
});
const section = {
  id: 'sps_00000000000000000000000001',
  bookId: book().id,
  sectionNumber: '03 30 00',
  title: 'Concrete',
  division: '03',
  pageFrom: 4,
  pageTo: 20,
  revision: null,
};

beforeEach(() => {
  fake.reset();
  nav.search = '';
  fake.on('GET', P, () => ({ data: [book()] }));
  fake.on('GET', `${P}/{bookId}`, () => ({ book: book(), sections: [section] }));
});

describe('section lines', () => {
  it('reads number, title and pages, and says what is wrong with a line', () => {
    const r = parseSections(
      '03 30 00, Cast-in-place concrete, 4-20\n\n09 30 00, Tiling, wall and floor, 21\nnonsense\n05 00 00, Steel, 9-3',
    );
    expect(r.sections).toEqual([
      { sectionNumber: '03 30 00', title: 'Cast-in-place concrete', pageFrom: 4, pageTo: 20 },
      { sectionNumber: '09 30 00', title: 'Tiling, wall and floor', pageFrom: 21, pageTo: 21 },
    ]);
    expect(r.problems.map((p) => p.line)).toEqual([4, 5]);
  });

  it('round trips', () => {
    const text = '03 30 00, Concrete, 4-20\n09 30 00, Tiling, 21';
    expect(sectionsToText(parseSections(text).sections as never)).toBe(text);
  });
});

describe('SpecificationsScreen', () => {
  it("lists the books and shows a book's sections", async () => {
    nav.search = 'book=spb_00000000000000000000000001';
    renderInProject(<SpecificationsScreen />);
    expect(await screen.findByRole('button', { name: 'Architectural spec, Issue A' })).toBeTruthy();
    const table = await screen.findByRole('table', { name: 'Sections' });
    expect(within(table).getByText('03 30 00')).toBeTruthy();
    expect(within(table).getByText('pp. 4–20')).toBeTruthy();
  });

  it('saves the edited section list against the book version', async () => {
    const user = userEvent.setup();
    nav.search = 'book=spb_00000000000000000000000001';
    fake.on('PUT', `${P}/{bookId}/sections`, () => ({
      book: book({ version: 3 }),
      sections: [section],
    }));
    renderInProject(<SpecificationsScreen />);
    await user.click(await screen.findByRole('button', { name: 'Edit sections' }));
    const box = screen.getByLabelText(/Sections, one per line/);
    await user.clear(box);
    await enterText(user, box, '03 30 00, Concrete, 4-20\n09 30 00, Tiling, 21');
    await user.click(screen.getByRole('button', { name: 'Save sections' }));
    await waitFor(() => expect(fake.callsTo('PUT', `${P}/{bookId}/sections`)).toHaveLength(1));
    const [call] = fake.callsTo('PUT', `${P}/{bookId}/sections`);
    expect(call!.init.body).toEqual({
      sections: [
        { sectionNumber: '03 30 00', title: 'Concrete', pageFrom: 4, pageTo: 20 },
        { sectionNumber: '09 30 00', title: 'Tiling', pageFrom: 21, pageTo: 21 },
      ],
    });
  });

  it('will not save while a line cannot be read', async () => {
    const user = userEvent.setup();
    nav.search = 'book=spb_00000000000000000000000001';
    renderInProject(<SpecificationsScreen />);
    await user.click(await screen.findByRole('button', { name: 'Edit sections' }));
    await user.clear(screen.getByLabelText(/Sections, one per line/));
    await enterText(user, screen.getByLabelText(/Sections, one per line/), 'just words');
    expect(screen.getByText(/Line 1: Use: number, title, pages/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Save sections' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('registers a book that replaces the current one', async () => {
    const user = userEvent.setup();
    fake.on('POST', P, () => ({
      book: book({ id: 'spb_00000000000000000000000002', name: 'Issue B', sectionCount: 0 }),
      sections: [],
    }));
    renderInProject(<SpecificationsScreen />);
    await user.click(await screen.findByRole('button', { name: 'Register a book' }));
    await enterText(user, screen.getByLabelText('Name'), 'Issue B');
    await user.selectOptions(screen.getByLabelText('Replaces'), book().id);
    await user.click(screen.getByRole('button', { name: 'Register book' }));
    await waitFor(() => expect(fake.callsTo('POST', P)).toHaveLength(1));
    expect(fake.callsTo('POST', P)[0]!.init.body).toEqual({
      name: 'Issue B',
      supersedesBookId: book().id,
    });
  });
});

describe('SpecSectionField', () => {
  it('suggests sections from the current books while typing, and still takes free text', async () => {
    fake.on('GET', '/v1/orgs/{orgId}/projects/{projectId}/spec-sections', () => ({
      data: [{ section, bookId: book().id, bookName: book().name }],
    }));
    const { SpecSectionField } = await import('../components/SpecSectionField');
    const { useState } = await import('react');
    function Harness() {
      const [v, setV] = useState('');
      return <SpecSectionField value={v} onChange={setV} />;
    }
    const { container } = renderInProject(<Harness />);
    const user = userEvent.setup();
    const input = screen.getByLabelText('Spec section') as HTMLInputElement;
    await user.type(input, '03');
    await waitFor(() =>
      expect(container.querySelector('datalist option')?.getAttribute('value')).toBe(
        '03 30 00 Concrete',
      ),
    );
    await user.clear(input);
    await user.type(input, 'Site notes');
    expect(input.value).toBe('Site notes');
  });
});
