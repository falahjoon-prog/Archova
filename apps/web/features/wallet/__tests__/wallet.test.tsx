// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
const flag = vi.hoisted(() => ({ on: true }));
vi.mock('@/shared/hooks/useFeatureFlag', () => ({ useFeatureFlag: () => flag.on }));

const { WalletScreen } = await import('../screens/WalletScreen');
const { centsToDollars, dollarsToCents } = await import('../lib/types');

const D = '/v1/orgs/{orgId}/compliance-documents';
const base = {
  itemType: 'public_liability',
  title: 'Public liability 2026',
  numberLast4: '1234',
  numberCheck: 'not_checked',
  issuingState: null,
  licenceClass: null,
  insurer: 'Acme Insurance',
  limitCents: 2000000000,
  startsOn: null,
  expiresOn: '2027-01-10',
  fileIds: ['fil_01HZZZZZZZZZZZZZZZZZZZZZZZ'],
  evidence: 'recorded',
  expiry: 'expiring',
  sightedBy: null,
  sightedAt: null,
  archivedAt: null,
  version: 1,
  createdAt: '2026-11-01T00:00:00Z',
};
const doc = { ...base, id: 'cdo_01HZZZZZZZZZZZZZZZZZZZZZZ1' };

const A = '/v1/orgs/{orgId}/compliance-document-alerts';

beforeEach(() => {
  fake.reset();
  fake.on('GET', A, () => ({ data: [] }));
  flag.on = true;
  fake.on('GET', D, () => ({ data: [doc] }));
});

describe('dollars and cents', () => {
  it('converts typed amounts', () => {
    expect(dollarsToCents('$20,000.50')).toBe(2000050);
    expect(dollarsToCents('')).toBeNull();
    expect(dollarsToCents('abc')).toBeNaN();
    expect(centsToDollars(2000050)).toBe('20000.50');
  });
});

describe('WalletScreen', () => {
  it('lists documents with expiry and evidence, never "verified"', async () => {
    renderInProject(<WalletScreen />);
    expect((await screen.findAllByText('Public liability 2026')).length).toBeGreaterThan(0);
    expect(screen.getByText('Expiring soon')).toBeTruthy();
    expect(screen.getByText(/Number ends in 1234/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/verified(?!”)/i);
  });

  it('shows a format check as "Format checked", never verified', async () => {
    fake.on('GET', D, () => ({ data: [{ ...doc, itemType: 'abn', numberCheck: 'format_ok' }] }));
    renderInProject(<WalletScreen />);
    expect(await screen.findByText('Format checked')).toBeTruthy();
    expect(document.body.textContent).toMatch(/Not checked with the register/);
    expect(document.body.textContent).not.toMatch(/verified(?!”)/i);
  });

  it('shows no check pill for a number that was not checked', async () => {
    renderInProject(<WalletScreen />);
    await screen.findAllByText('Public liability 2026');
    expect(screen.queryByText('Format checked')).toBeNull();
  });

  it('lists expiry alerts with their threshold', async () => {
    fake.on('GET', A, () => ({
      data: [
        {
          id: 'cea_01HZZZZZZZZZZZZZZZZZZZZZZ1',
          documentId: doc.id,
          title: 'Public liability 2026',
          itemType: 'public_liability',
          threshold: 7,
          expiresOn: '2027-01-10',
          raisedOn: '2027-01-03',
          documentArchived: false,
        },
      ],
    }));
    renderInProject(<WalletScreen />);
    expect(await screen.findByText('Expires within 7 days')).toBeTruthy();
    expect(screen.getByText('Expiry alerts')).toBeTruthy();
  });

  it('marks a document sighted with its version', async () => {
    const user = userEvent.setup();
    fake.on('POST', `${D}/{documentId}/sight`, () => ({ ...doc, evidence: 'sighted', version: 2 }));
    renderInProject(<WalletScreen />);
    await user.click(await screen.findByRole('button', { name: /Mark sighted/ }));
    await waitFor(() => expect(fake.callsTo('POST', `${D}/{documentId}/sight`)).toHaveLength(1));
    expect(fake.callsTo('POST', `${D}/{documentId}/sight`)[0]!.init.params?.header).toEqual({
      'If-Match': '"1"',
    });
  });

  it('archives a document', async () => {
    const user = userEvent.setup();
    fake.on('PATCH', `${D}/{documentId}`, () => ({ ...doc, archivedAt: '2026-11-04T00:00:00Z' }));
    renderInProject(<WalletScreen />);
    await user.click(await screen.findByRole('button', { name: /Archive/ }));
    await waitFor(() => expect(fake.callsTo('PATCH', `${D}/{documentId}`)).toHaveLength(1));
    expect(fake.callsTo('PATCH', `${D}/{documentId}`)[0]!.init.body).toEqual({ archived: true });
  });

  it('adds a self-declared item without a file', async () => {
    const user = userEvent.setup();
    fake.on('GET', D, () => ({ data: [] }));
    fake.on('POST', D, () => ({ ...doc, evidence: 'self_declared' }));
    renderInProject(<WalletScreen />);
    await user.click((await screen.findAllByRole('button', { name: 'Add document' }))[0]!);
    await enterText(user, screen.getByLabelText(/Title/), 'No employees');
    await user.click(screen.getByLabelText(/No document, a declaration only/));
    await user.click(screen.getAllByRole('button', { name: 'Add document' }).at(-1)!);
    await waitFor(() => expect(fake.callsTo('POST', D)).toHaveLength(1));
    expect(fake.callsTo('POST', D)[0]!.init.body).toMatchObject({
      title: 'No employees',
      selfDeclared: true,
    });
  });

  it('asks for a file unless the item is a declaration', async () => {
    const user = userEvent.setup();
    renderInProject(<WalletScreen />);
    await user.click((await screen.findAllByRole('button', { name: 'Add document' }))[0]!);
    await enterText(user, screen.getByLabelText(/Title/), 'Licence');
    await user.click(screen.getAllByRole('button', { name: 'Add document' }).at(-1)!);
    expect(await screen.findByText(/Add a file/)).toBeTruthy();
    expect(fake.callsTo('POST', D)).toHaveLength(0);
  });

  it('says so when the flag is off', async () => {
    flag.on = false;
    renderInProject(<WalletScreen />);
    expect(await screen.findByText(/isn’t switched on/)).toBeTruthy();
  });
});
