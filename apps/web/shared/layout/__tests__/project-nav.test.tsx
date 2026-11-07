// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentsIcon, DrawingsIcon, RfisIcon } from '@archova/ui/icons';
import { ProjectNav, type ProjectNavGroup } from '../ProjectNav';

let pathname = '/p/drawings';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

const groups: ProjectNavGroup[] = [
  {
    id: 'documents',
    label: 'Documents',
    icon: DocumentsIcon,
    items: [{ href: '/p/drawings', label: 'Drawings', icon: DrawingsIcon }],
  },
  {
    id: 'communication',
    label: 'Communication',
    icon: RfisIcon,
    items: [{ href: '/p/rfis', label: 'RFIs', icon: RfisIcon }],
  },
];

describe('ProjectNav groups', () => {
  beforeEach(() => {
    window.localStorage.clear();
    pathname = '/p/drawings';
  });

  it('toggles a group open and closed and remembers it', () => {
    const { unmount } = render(<ProjectNav projectName="P" groups={groups} />);
    const header = screen.getByRole('button', { name: /Communication/ });
    expect(header.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('false');
    unmount();
    render(<ProjectNav projectName="P" groups={groups} />);
    expect(
      screen.getByRole('button', { name: /Communication/ }).getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('reopens the group of the current page', () => {
    window.localStorage.setItem('archova.groups.sidebar', JSON.stringify(['documents']));
    render(<ProjectNav projectName="P" groups={groups} />);
    expect(screen.getByRole('button', { name: /Documents/ }).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });
});

describe('ProjectNav favourites', () => {
  const withHome: ProjectNavGroup[] = [
    { items: [{ href: '/p', label: 'Project home', icon: DocumentsIcon, exact: true }] },
    ...groups,
  ];
  beforeEach(() => window.localStorage.clear());

  it('stars a tool, pins it in a Starred group and remembers it per user', () => {
    const { unmount } = render(
      <ProjectNav projectName="P" groups={withHome} favouritesScope="u1" />,
    );
    expect(screen.queryByRole('button', { name: 'Star Project home' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Star RFIs' }));
    expect(screen.getByText('Starred')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unstar RFIs' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    // Pinned, not duplicated.
    expect(screen.getAllByRole('link', { name: /RFIs/ })).toHaveLength(1);
    unmount();
    render(<ProjectNav projectName="P" groups={withHome} favouritesScope="u1" />);
    expect(screen.getByText('Starred')).toBeTruthy();
    unmount();
  });

  it('shows no stars without a user', () => {
    render(<ProjectNav projectName="P" groups={withHome} />);
    expect(screen.queryByRole('button', { name: /^Star / })).toBeNull();
  });
});

describe('ProjectNav quick-add', () => {
  it('shows a plus link to the create form for tools that have one', () => {
    render(
      <ProjectNav
        projectName="P"
        groups={[
          {
            items: [
              {
                href: '/p/rfis',
                label: 'RFIs',
                icon: RfisIcon,
                createHref: '/p/rfis/new',
                createLabel: 'New RFI',
              },
              { href: '/p/drawings', label: 'Drawings', icon: DrawingsIcon },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByRole('link', { name: 'New RFI' }).getAttribute('href')).toBe('/p/rfis/new');
    expect(screen.queryByRole('link', { name: /^New Drawings/ })).toBeNull();
  });
});
