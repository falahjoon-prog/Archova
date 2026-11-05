// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, nav, renderInProject } from '@/test/render';
import { incidentsPreview, resetIncidentsPreview } from '../data/source';
import { LinkedIncidentActions } from '../components/LinkedIncidentActions';
import { IncidentsScreen } from '../screens/IncidentsScreen';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

beforeEach(() => {
  resetIncidentsPreview();
  nav.search = '';
});

describe('IncidentsScreen', () => {
  it('lists incidents and reports a new one', async () => {
    const user = userEvent.setup();
    renderInProject(<IncidentsScreen />);
    const table = await screen.findByRole('table', { name: 'Incidents' });
    expect(within(table).getByText('INC-0001')).toBeTruthy();
    expect(within(table).getAllByText('Notifiable')).toHaveLength(2); // column header and the pill
    await user.click(screen.getByRole('button', { name: /Report incident/ }));
    await enterText(user, screen.getByLabelText('Title'), 'Ladder slipped');
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Report incident' }),
    );
    expect(await screen.findByText('INC-0003')).toBeTruthy();
    const added = (await incidentsPreview.list('prj_test', {})).find(
      (i) => i.numberLabel === 'INC-0003',
    );
    expect(added!.title).toBe('Ladder slipped');
    expect(added!.occurredAt).toMatch(/Z$/);
  });

  it('shows the notifiable notices and refuses to close until the blockers are cleared', async () => {
    const user = userEvent.setup();
    nav.search = 'id=inx_0002';
    renderInProject(<IncidentsScreen />);
    expect(await screen.findByText(/Archova does not notify the regulator/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Start investigation' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Start investigation' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Close incident' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Record the root cause before closing.')).toBeTruthy();
    expect(
      (within(dialog).getByRole('button', { name: 'Close incident' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('runs a corrective action from open to verified', async () => {
    const user = userEvent.setup();
    nav.search = 'id=inx_0001';
    renderInProject(<IncidentsScreen />);
    await user.click(await screen.findByRole('button', { name: 'Add corrective action' }));
    await enterText(user, screen.getByLabelText('Action'), 'Fit toe boards');
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Add action' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Mark Fit toe boards done' }));
    await user.click(await screen.findByRole('button', { name: 'Verify Fit toe boards' }));
    await waitFor(async () =>
      expect((await incidentsPreview.get('prj_test', 'inx_0001')).actions[0]!.status).toBe(
        'verified',
      ),
    );
    expect(await screen.findByText('Verified')).toBeTruthy();
  });

  it('shows the corrective actions an incident raised from an inspection, and nothing otherwise', async () => {
    const detail = await incidentsPreview.get('prj_test', 'inx_0001');
    await incidentsPreview.addAction('prj_test', detail, {
      title: 'Re-inspect the scaffold',
      source: { type: 'inspection', id: 'ins_0001' },
    });
    const none = renderInProject(
      <LinkedIncidentActions source={{ type: 'inspection', id: 'ins_other' }} />,
    );
    await waitFor(() => expect(none.container.textContent).toBe(''));
    none.unmount();
    renderInProject(<LinkedIncidentActions source={{ type: 'inspection', id: 'ins_0001' }} />);
    expect(await screen.findByText(/Re-inspect the scaffold/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'INC-0001' })).toBeTruthy();
  });
});
