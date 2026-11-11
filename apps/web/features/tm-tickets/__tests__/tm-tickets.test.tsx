// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, renderInProject } from '@/test/render';
import { centsToAmount, lineCents, lineProblem, blankLine } from '../lib/tm';
import type { TmTicketDetail } from '../data/api';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { TmTicketForm } = await import('../components/TmTicketForm');
const { TmTicketDetailCard } = await import('../components/TmTicketDetail');

const P = '/v1/orgs/{orgId}/projects/{projectId}';
const ticket = (over: Partial<TmTicketDetail> = {}): TmTicketDetail => ({
  id: 'tmt_1',
  number: 1,
  title: 'Extra excavation',
  description: null,
  workDate: '2026-11-03',
  location: 'Level 2',
  contractor: 'Acme',
  instructedBy: null,
  reference: null,
  notes: null,
  reviewStage: 'field_verified',
  verifyNote: null,
  origin: 'nova',
  status: 'draft',
  total: '680.00',
  convertedTo: null,
  convertedAt: null,
  variationId: null,
  voidReason: null,
  createdAt: '2026-11-04T00:00:00Z',
  lines: [
    {
      kind: 'labour',
      description: 'Dan',
      quantity: '8.00',
      unit: 'hr',
      rate: '85.00',
      amount: '680.00',
      sourceType: 'timesheet_line',
      sourceId: '018f0000-0000-7000-8000-000000000001',
    },
  ],
  signoffs: [],
  ...over,
});

beforeEach(() => {
  fake.reset();
  fake.on('GET', `${P}/budget`, () => ({ id: 'bud_1', status: 'locked', lines: [], totals: {} }));
  fake.on('GET', `${P}/contracts`, () => ({ data: [] }));
  fake.on('GET', `${P}/tm-tickets/{tmTicketId}/checks`, () => ({ findings: [] }));
});

describe('T&M line maths', () => {
  it('prices like the server and flags the first bad line', () => {
    expect(lineCents('4.5', '140')).toBe(63000);
    expect(lineCents('1.50', '33.33')).toBe(5000);
    expect(lineCents('x', '1')).toBe(0);
    expect(centsToAmount(5)).toBe('0.05');
    const l = { ...blankLine(), description: 'Dan', quantity: '8', rate: '' };
    expect(lineProblem([l])).toMatch(/Line 1: enter the rate/);
    expect(lineProblem([])).toBe('Add at least one line.');
  });
});

describe('TmTicketForm', () => {
  it('drafts unpriced lines from the day, then needs rates before saving', async () => {
    fake.on('GET', `${P}/tm-tickets/suggestion`, () => ({
      date: '2026-11-03',
      lines: [
        {
          kind: 'labour',
          description: 'Dan',
          quantity: '8.00',
          unit: 'hr',
          rate: '0.00',
          sourceType: 'timesheet_line',
          sourceId: '018f0000-0000-7000-8000-000000000001',
        },
      ],
    }));
    fake.on('POST', `${P}/tm-tickets`, () => ticket());
    const user = userEvent.setup();
    renderInProject(<TmTicketForm onCreated={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Draft from this day with Nova' }));
    expect(await screen.findByDisplayValue('Dan')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save ticket' }));
    expect(await screen.findByText(/Line 1: enter the rate/)).toBeTruthy();
    expect(fake.callsTo('POST', `${P}/tm-tickets`)).toHaveLength(0);

    await enterText(user, screen.getByLabelText(/^Rate/), '85');
    await user.click(screen.getByRole('button', { name: 'Save ticket' }));
    await waitFor(() => expect(fake.callsTo('POST', `${P}/tm-tickets`)).toHaveLength(1));
    expect(fake.callsTo('POST', `${P}/tm-tickets`)[0]!.init.body).toMatchObject({
      origin: 'nova',
      lines: [{ description: 'Dan', rate: '85', sourceType: 'timesheet_line' }],
    });
  });
});

describe('TmTicketDetailCard', () => {
  it('signs a draft ticket with a name', async () => {
    fake.on('GET', `${P}/tm-tickets/{tmTicketId}`, () => ticket());
    fake.on('POST', `${P}/tm-tickets/{tmTicketId}/sign`, () => ticket({ status: 'part_signed' }));
    const user = userEvent.setup();
    renderInProject(
      <TmTicketDetailCard id="tmt_1" canManage canSign canConvert onClose={() => {}} />,
    );
    await screen.findByText('T&M-1: Extra excavation');
    await user.click(screen.getByRole('button', { name: 'Record signature' }));
    expect(await screen.findByText('Type the signer’s full name.')).toBeTruthy();
    await enterText(user, screen.getByLabelText(/Full name/), 'Pat Manager');
    await user.click(screen.getByRole('button', { name: 'Record signature' }));
    await waitFor(() =>
      expect(fake.callsTo('POST', `${P}/tm-tickets/{tmTicketId}/sign`)).toHaveLength(1),
    );
    expect(fake.callsTo('POST', `${P}/tm-tickets/{tmTicketId}/sign`)[0]!.init.body).toEqual({
      role: 'contractor',
      signerName: 'Pat Manager',
    });
  });

  it('moves a draft ticket through ready for review and field verified before signing', async () => {
    fake.on('GET', `${P}/tm-tickets/{tmTicketId}`, () =>
      ticket({ reviewStage: 'ready_for_review' }),
    );
    fake.on('POST', `${P}/tm-tickets/{tmTicketId}/review`, () =>
      ticket({ reviewStage: 'field_verified' }),
    );
    const user = userEvent.setup();
    renderInProject(
      <TmTicketDetailCard id="tmt_1" canManage canSign canConvert onClose={() => {}} />,
    );
    await screen.findByText('T&M-1: Extra excavation');
    expect(screen.getByText('Ready for review')).toBeTruthy();
    expect(screen.getByText(/have a second person field verify it/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record signature' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Field verify' }));
    await waitFor(() =>
      expect(fake.callsTo('POST', `${P}/tm-tickets/{tmTicketId}/review`)).toHaveLength(1),
    );
    expect(fake.callsTo('POST', `${P}/tm-tickets/{tmTicketId}/review`)[0]!.init.body).toEqual({
      stage: 'field_verified',
    });
  });

  it('asks for a docket photo before recording the principal’s representative', async () => {
    fake.on('GET', `${P}/tm-tickets/{tmTicketId}`, () =>
      ticket({
        status: 'part_signed',
        signoffs: [
          {
            role: 'contractor',
            signerName: 'Pat',
            signerPosition: null,
            hasEvidence: false,
            evidenceFileId: null,
            geofenceStatus: 'outside',
            hasPosition: true,
            contentHash: 'a'.repeat(64),
            signedAt: '2026-11-04T00:00:00Z',
          },
        ],
      }),
    );
    const user = userEvent.setup();
    renderInProject(
      <TmTicketDetailCard id="tmt_1" canManage canSign canConvert onClose={() => {}} />,
    );
    await screen.findByText(/signed on site by Pat/);
    expect(screen.getByText(/outside the site fence/)).toBeTruthy();
    await enterText(user, screen.getByLabelText(/Full name/), 'Sam Lee');
    await user.click(screen.getByRole('button', { name: 'Record signature' }));
    expect(await screen.findByText(/Attach a photo of the docket/)).toBeTruthy();
    expect(fake.callsTo('POST', `${P}/tm-tickets/{tmTicketId}/sign`)).toHaveLength(0);
  });

  it('shows Nova’s checks on the ticket', async () => {
    fake.on('GET', `${P}/tm-tickets/{tmTicketId}`, () => ticket());
    fake.on('GET', `${P}/tm-tickets/{tmTicketId}/checks`, () => ({
      findings: [
        {
          code: 'no_diary_entry',
          severity: 'warn',
          message: 'There is no site diary entry for 2026-11-03.',
          line: null,
        },
      ],
    }));
    renderInProject(
      <TmTicketDetailCard id="tmt_1" canManage canSign canConvert onClose={() => {}} />,
    );
    expect(await screen.findByText(/no site diary entry for 2026-11-03/)).toBeTruthy();
  });

  it('offers conversion only when fully signed and the person may convert', async () => {
    fake.on('GET', `${P}/tm-tickets/{tmTicketId}`, () => ticket({ status: 'signed' }));
    const { unmount } = renderInProject(
      <TmTicketDetailCard id="tmt_1" canManage canSign canConvert onClose={() => {}} />,
    );
    expect(await screen.findByRole('button', { name: 'Convert ticket' })).toBeTruthy();
    unmount();
    renderInProject(
      <TmTicketDetailCard id="tmt_1" canManage canSign canConvert={false} onClose={() => {}} />,
    );
    await screen.findByText('T&M-1: Extra excavation');
    expect(screen.queryByRole('button', { name: 'Convert ticket' })).toBeNull();
  });
});
