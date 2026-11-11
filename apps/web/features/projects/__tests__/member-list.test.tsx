// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ProjectMember } from '@archova/contracts';
import { MemberList } from '../components/MemberList';

const member = (over: Partial<ProjectMember>): ProjectMember => ({
  id: 'pmb_1',
  projectId: 'prj_1',
  userId: 'usr_1',
  name: 'Sam Sparks',
  email: 'sam@sparky.example',
  phone: '0400 111 222',
  jobTitle: 'Foreman',
  trade: 'Electrical',
  companyId: 'cmp_1',
  permissionTemplateId: 'ptp_1',
  isExternal: true,
  status: 'active',
  ...over,
});

const members = [
  member({}),
  member({
    id: 'pmb_2',
    name: 'Pat Pipes',
    email: 'pat@pipes.example',
    phone: null,
    jobTitle: null,
    trade: 'Plumbing',
    companyId: 'cmp_2',
  }),
];
const props = {
  members,
  companyNames: new Map([
    ['cmp_1', 'Sparky Electrical'],
    ['cmp_2', 'Pipes Plumbing'],
  ]),
  templateNames: new Map([['ptp_1', 'Subcontractor']]),
};

describe('MemberList directory', () => {
  it('shows phone, title and trade, and dashes where they are not set', () => {
    render(<MemberList {...props} />);
    expect(screen.getByRole('link', { name: '0400 111 222' }).getAttribute('href')).toBe(
      'tel:0400111222',
    );
    expect(screen.getByText('Foreman')).toBeTruthy();
    expect(screen.getAllByText('Plumbing').length).toBeGreaterThan(0);
  });

  it('searches across name, trade and company, and says when nothing matches', () => {
    render(<MemberList {...props} />);
    const search = screen.getByLabelText('Search');
    fireEvent.change(search, { target: { value: 'pipes' } });
    expect(screen.queryByText('Sam Sparks')).toBeNull();
    expect(screen.getByText('Pat Pipes')).toBeTruthy();
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByRole('status').textContent).toContain('No one matches');
  });

  it('offers Edit only when the caller can manage members', () => {
    const { rerender } = render(<MemberList {...props} />);
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull();
    rerender(<MemberList {...props} edit={{ orgId: 'org_1', projectId: 'prj_1' }} />);
    expect(screen.getAllByRole('button', { name: /Edit/ }).length).toBe(2);
  });
});
