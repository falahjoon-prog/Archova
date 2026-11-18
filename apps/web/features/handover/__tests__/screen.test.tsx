// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, nav, renderInProject } from '@/test/render';
import { handoverPreview, resetHandoverPreview } from '../data/source';
import { exportCsv } from '../lib/types';
import { HandoverScreen } from '../screens/HandoverScreen';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

beforeEach(() => {
  resetHandoverPreview();
  nav.search = '';
});

describe('HandoverScreen', () => {
  it('shows progress, the checklist and Nova flags', async () => {
    renderInProject(<HandoverScreen />);
    const table = await screen.findByRole('table', { name: 'Handover checklist' });
    expect(within(table).getByText('HND-0001')).toBeTruthy();
    expect(within(table).getByText('Approved')).toBeTruthy();
    expect(within(table).getByText('Overdue')).toBeTruthy();
    expect(await screen.findByText(/HND-0003 .* is overdue/)).toBeTruthy();
    expect(await screen.findByText(/HND-0002 .* is waiting for approval/)).toBeTruthy();
    expect(screen.getByText('Required items complete')).toBeTruthy();
  });

  it('will not mark an item received without a file, then receives and approves it', async () => {
    const user = userEvent.setup();
    renderInProject(<HandoverScreen />);
    await screen.findByRole('table', { name: 'Handover checklist' });
    await user.click(screen.getByRole('button', { name: 'Edit HND-0004' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark received' }),
    );
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', {
      name: 'Mark received',
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.upload(
      within(dialog).getByLabelText('Files'),
      new File(['x'], 'coc.pdf', { type: 'application/pdf' }),
    );
    expect(confirm.disabled).toBe(false);
    await user.click(confirm);
    await waitFor(async () => {
      const item = (await handoverPreview.pack('prj_test')).items.find(
        (i) => i.numberLabel === 'HND-0004',
      );
      expect(item?.status).toBe('received');
    });
    await user.click(await screen.findByRole('button', { name: 'Approve HND-0004' }));
    await waitFor(async () => {
      const item = (await handoverPreview.pack('prj_test')).items.find(
        (i) => i.numberLabel === 'HND-0004',
      );
      expect(item?.status).toBe('approved');
    });
  });

  it('needs a reason to mark an item not applicable', async () => {
    const user = userEvent.setup();
    renderInProject(<HandoverScreen />);
    await screen.findByRole('table', { name: 'Handover checklist' });
    await user.click(screen.getByRole('button', { name: 'Edit HND-0006' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Not applicable' }),
    );
    const dialog = screen.getByRole('dialog');
    const save = within(dialog).getByRole('button', {
      name: 'Not applicable',
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await enterText(user, within(dialog).getByLabelText('Reason'), 'No keys on this project');
    await user.click(save);
    await waitFor(async () => {
      const item = (await handoverPreview.pack('prj_test')).items.find(
        (i) => i.numberLabel === 'HND-0006',
      );
      expect(item?.status).toBe('not_applicable');
    });
  });

  it('asks the issuer to confirm when required items are outstanding', async () => {
    const user = userEvent.setup();
    renderInProject(<HandoverScreen />);
    await screen.findByRole('table', { name: 'Handover checklist' });
    await user.click(screen.getByRole('button', { name: 'Issue to client' }));
    const dialog = screen.getByRole('dialog');
    await enterText(user, within(dialog).getByLabelText('Issued to'), 'The Client Pty Ltd');
    const record = within(dialog).getByRole('button', {
      name: 'Record issue',
    }) as HTMLButtonElement;
    expect(record.disabled).toBe(true);
    await user.click(within(dialog).getByLabelText('Issue it with the outstanding items'));
    expect(record.disabled).toBe(false);
    await user.click(record);
    await waitFor(async () => {
      const p = await handoverPreview.pack('prj_test');
      expect(p.issues[0]).toMatchObject({
        recipientName: 'The Client Pty Ltd',
        incompleteCount: 4,
      });
    });
  });

  it('filters the checklist from the address', async () => {
    nav.search = 'state=overdue';
    renderInProject(<HandoverScreen />);
    const table = await screen.findByRole('table', { name: 'Handover checklist' });
    expect(within(table).getByText('HND-0003')).toBeTruthy();
    expect(within(table).queryByText('HND-0001')).toBeNull();
  });
});

describe('exportCsv', () => {
  it('quotes commas and lists files by name', () => {
    const csv = exportCsv({
      projectName: 'P',
      generatedAt: '2026-11-18T00:00:00Z',
      summary: {
        total: 1,
        required: 1,
        requiredComplete: 0,
        complete: 0,
        received: 0,
        overdue: 0,
        percentComplete: 0,
        byCategory: [],
      },
      items: [
        {
          numberLabel: 'HND-0001',
          category: 'om_manual',
          title: 'Lift manual, level 2 "A"',
          required: true,
          status: 'received',
          files: [
            { id: 'f1', filename: 'a.pdf', sizeBytes: 1 },
            { id: 'f2', filename: 'b.pdf', sizeBytes: 1 },
          ],
        },
      ],
    });
    expect(csv.startsWith('﻿No.,Category')).toBe(true);
    expect(csv).toContain('"Lift manual, level 2 ""A"""');
    expect(csv).toContain('a.pdf; b.pdf');
  });
});
