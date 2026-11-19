// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, nav, renderInProject } from '@/test/render';
import { declarationsPreview, resetDeclarationsPreview } from '../data/source';
import { DeclarationsScreen } from '../screens/DeclarationsScreen';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

beforeEach(() => {
  resetDeclarationsPreview();
  nav.search = '';
});

const CLAIMS = 'Open subcontract claims and their declarations';
const REGISTER = 'Subcontractor declarations';

describe('DeclarationsScreen', () => {
  it('shows each open claim with what is missing, and the register with derived status', async () => {
    renderInProject(<DeclarationsScreen />);
    const claims = await screen.findByRole('table', { name: CLAIMS });
    const elec = within(claims).getByText('Claim 3').closest('tr')!;
    expect(within(elec).getByText('Complete')).toBeTruthy();
    const plumb = within(claims).getByText('Claim 2').closest('tr')!;
    expect(within(plumb).getByText('Missing')).toBeTruthy();
    expect(within(plumb).getByText(/No payroll tax declaration received/)).toBeTruthy();
    // A subcontractor's statement stands for all three.
    const tile = within(claims).getByText('Claim 1').closest('tr')!;
    expect(within(tile).getByText(/Covered by the subcontractor’s statement/)).toBeTruthy();

    const register = await screen.findByRole('table', { name: REGISTER });
    expect(within(register).getByText('DEC-0001')).toBeTruthy();
    expect(within(register).getByText('Running out')).toBeTruthy();
    expect(await screen.findByText(/Bayside Hydraulics: DEC-0004/)).toBeTruthy();
  });

  it('records a declaration, refusing an end date before the start date', async () => {
    const user = userEvent.setup();
    renderInProject(<DeclarationsScreen />);
    await screen.findByRole('table', { name: REGISTER });
    await user.click(screen.getAllByRole('button', { name: /Record a declaration/ })[0]!);
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Declaration'), 'payroll_tax');
    await user.selectOptions(within(dialog).getByLabelText('Company'), 'cmp_plumb');
    await enterText(user, within(dialog).getByLabelText('Covers from'), '2026-10-01');
    await enterText(user, within(dialog).getByLabelText('Covers to'), '2026-09-01');
    expect(within(dialog).getByText('The end date is before the start date.')).toBeTruthy();
    expect(
      (within(dialog).getByRole('button', { name: 'Add to register' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await user.clear(within(dialog).getByLabelText('Covers to'));
    await enterText(user, within(dialog).getByLabelText('Covers to'), '2026-10-31');
    await user.click(within(dialog).getByRole('button', { name: 'Add to register' }));
    expect(await screen.findByText('DEC-0005')).toBeTruthy();
  });

  it('fills the form from a Nova reading and keeps it for a person to check', async () => {
    const user = userEvent.setup();
    renderInProject(<DeclarationsScreen />);
    await screen.findByRole('table', { name: REGISTER });
    await user.click(screen.getAllByRole('button', { name: /Record a declaration/ })[0]!);
    const dialog = screen.getByRole('dialog');
    const file = new File(['%PDF'], 'workcover-certificate.pdf', { type: 'application/pdf' });
    await user.upload(within(dialog).getByLabelText('Declaration PDF'), file);
    expect(await within(dialog).findByText(/Nova filled in what it could find/)).toBeTruthy();
    expect(
      (within(dialog).getByLabelText('Policy or reference number') as HTMLInputElement).value,
    ).toBe('WC-771204');
    // The company name matches one on the project, so it is chosen; the person still presses Add.
    expect((within(dialog).getByLabelText('Company') as HTMLSelectElement).value).toBe('cmp_plumb');
    await user.click(within(dialog).getByRole('button', { name: 'Add to register' }));
    expect(await screen.findByText(/Read by Nova, checked by a person/)).toBeTruthy();
  });

  it('rejects a declaration with a reason and accepts it again', async () => {
    const user = userEvent.setup();
    renderInProject(<DeclarationsScreen />);
    await screen.findByRole('table', { name: REGISTER });
    await user.click(screen.getByRole('button', { name: 'Reject DEC-0002' }));
    const dialog = screen.getByRole('dialog');
    const reject = within(dialog).getByRole('button', { name: 'Reject' }) as HTMLButtonElement;
    expect(reject.disabled).toBe(true);
    await enterText(user, within(dialog).getByLabelText('Reason'), 'Unsigned');
    await user.click(reject);
    await waitFor(() =>
      expect(
        within(screen.getByRole('table', { name: REGISTER })).getAllByText('Rejected').length,
      ).toBeGreaterThan(0),
    );
    await user.click(await screen.findByRole('button', { name: 'Accept DEC-0002' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Accept DEC-0002' })).toBeNull(),
    );
  });

  it('drafts a chase for Nova without sending, then sends what the person saw', async () => {
    const user = userEvent.setup();
    const chase = vi.spyOn(declarationsPreview, 'chase');
    renderInProject(<DeclarationsScreen />);
    await screen.findByRole('table', { name: CLAIMS });
    await user.click(screen.getByRole('button', { name: 'Chase Bayside Hydraulics for claim 2' }));
    const dialog = await screen.findByRole('dialog');
    const subject = (await within(dialog).findByLabelText('Subject')) as HTMLInputElement;
    expect(subject.value).toContain('payment claim 2');
    expect(chase).toHaveBeenCalledTimes(1);
    expect(chase.mock.calls[0]![1]).toMatchObject({ send: false });
    // The words the draft uses never threaten payment.
    const message = within(dialog).getByLabelText('Message') as HTMLTextAreaElement;
    expect(message.value).toContain('Payroll tax');
    expect(message.value.toLowerCase()).not.toMatch(/withhold|not be paid|reduce/);
    await user.clear(subject);
    await enterText(user, subject, 'Declarations for claim 2 please');
    await user.click(within(dialog).getByRole('button', { name: 'Send email' }));
    expect(await within(dialog).findByText(/Sent to accounts@example.com/)).toBeTruthy();
    expect(chase.mock.calls[1]![1]).toMatchObject({
      send: true,
      subject: 'Declarations for claim 2 please',
    });
  });

  it('turns the check off when no declarations are required', async () => {
    const user = userEvent.setup();
    renderInProject(<DeclarationsScreen />);
    await screen.findByRole('table', { name: CLAIMS });
    await user.click(screen.getByRole('button', { name: 'Required declarations' }));
    const dialog = screen.getByRole('dialog');
    for (const name of [/Workers' compensation/, /Payroll tax/, /Wages and superannuation/])
      await user.click(within(dialog).getByRole('checkbox', { name }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/hasn’t chosen which declarations it needs/)).toBeTruthy();
  });
});
