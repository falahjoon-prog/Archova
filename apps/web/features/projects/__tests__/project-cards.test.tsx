// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Project } from '@archova/contracts';
import { ProjectCards } from '../components/ProjectCards';

const project = (over: Partial<Project>): Project =>
  ({
    id: 'prj_1',
    name: 'Paddington Terraces',
    number: 'HL-2401',
    state: 'NSW',
    status: 'active',
    ...over,
  }) as Project;

describe('ProjectCards', () => {
  it('links each card to its project and spells out the state and status', () => {
    render(
      <ProjectCards
        orgSlug="harbour-line"
        projects={[
          project({}),
          project({ id: 'prj_2', name: 'Docklands', number: null, state: null, status: 'tender' }),
        ]}
      />,
    );
    expect(
      screen.getByRole('link', { name: 'Paddington Terraces' }).getAttribute('href'),
    ).toContain('harbour-line');
    expect(screen.getByText('New South Wales')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('Tender')).toBeTruthy();
    expect(screen.getByText('No job number')).toBeTruthy();
    expect(screen.getByText('State not set')).toBeTruthy();
  });
});
