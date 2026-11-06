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
