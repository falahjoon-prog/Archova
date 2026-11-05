// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { SharingSection } = await import('../screens/SharingSection');

const O = '/v1/orgs/{orgId}';
const PREVIEW = `${O}/compliance-share-codes/preview`;
const GRANTS = `${O}/compliance-grants`;
const REVOKE = `${GRANTS}/{grantId}/revoke`;
const LOG = `${O}/compliance-access-log`;

const grant = {
  id: 'cgr_01HZZZZZZZZZZZZZZZZZZZZZZ1',
  granteeName: 'Harbour Builders',
  itemTypes: ['workers_comp', 'public_liability'],
  projectId: 'prj_01HZZZZZZZZZZZZZZZZZZZZZZ1',
  projectName: 'Wharf St',
  allProjects: false,
  expiresOn: '2027-06-30',
  acceptedAt: '2026-11-05T00:00:00Z',
  revokedAt: null,
  status: 'live',
  version: 3,
};

beforeEach(() => {
  fake.reset();
  fake.on('GET', GRANTS, () => ({ data: [] }));
  fake.on('GET', LOG, () => ({ data: [] }));
});

describe('SharingSection', () => {
  it('shows what the builder is asking for, then shares only when told to', async () => {
    const user = userEvent.setup();
    fake.on('POST', PREVIEW, () => ({
      requesterName: 'Harbour Builders',
      projectName: 'Wharf St',
      allProjects: false,
      itemTypes: ['workers_comp'],
      grantExpiresOn: '2027-06-30',
    }));
    fake.on('POST', GRANTS, () => grant);
    renderInProject(<SharingSection />);
    await enterText(user, await screen.findByLabelText('Code from the builder'), ' wlt_abcd-efgh ');
    await user.click(screen.getByRole('button', { name: 'See the request' }));
    expect(await screen.findByText('Harbour Builders is asking to read')).toBeTruthy();
    expect(fake.callsTo('POST', PREVIEW)[0]!.init.body).toEqual({ code: 'wlt_abcd-efgh' });
    // Looking at the request shares nothing.
    expect(fake.callsTo('POST', GRANTS)).toHaveLength(0);
    expect(document.body.textContent).toMatch(/working-with-children check is never shared/);

    await user.click(screen.getByRole('button', { name: 'Share these documents' }));
    await waitFor(() => expect(fake.callsTo('POST', GRANTS)).toHaveLength(1));
    expect(fake.callsTo('POST', GRANTS)[0]!.init.body).toEqual({ code: 'wlt_abcd-efgh' });
    expect(await screen.findByText('Shared with Harbour Builders.')).toBeTruthy();
  });

  it('answers a bad code in plain words', async () => {
    const user = userEvent.setup();
    const { fakeProblem } = await import('@/test/fake-api');
    fake.on('POST', PREVIEW, () => fakeProblem(404, 'compliance_code.invalid'));
    renderInProject(<SharingSection />);
    await enterText(user, await screen.findByLabelText('Code from the builder'), 'wlt_nope');
    await user.click(screen.getByRole('button', { name: 'See the request' }));
    expect(await screen.findByText(/That code isn’t valid/)).toBeTruthy();
  });

  it('lists who can read the wallet and ends an access with its version', async () => {
    const user = userEvent.setup();
    fake.on('GET', GRANTS, () => ({ data: [grant] }));
    fake.on('POST', REVOKE, () => ({ ...grant, status: 'revoked' }));
    renderInProject(<SharingSection />);
    expect(await screen.findByText('Harbour Builders')).toBeTruthy();
    expect(screen.getByText(/Workers compensation, Public liability insurance/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /End access/ }));
    await waitFor(() => expect(fake.callsTo('POST', REVOKE)).toHaveLength(1));
    expect(fake.callsTo('POST', REVOKE)[0]!.init.params?.header).toEqual({ 'If-Match': '"3"' });
  });

  it('offers no way to end an access that has already ended', async () => {
    fake.on('GET', GRANTS, () => ({ data: [{ ...grant, status: 'revoked' }] }));
    renderInProject(<SharingSection />);
    expect(await screen.findByText('Revoked')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /End access/ })).toBeNull();
  });

  it('shows the access log, newest first as the server sends it', async () => {
    fake.on('GET', LOG, () => ({
      data: [
        {
          id: 'cal_01HZZZZZZZZZZZZZZZZZZZZZZ2',
          granteeName: 'Harbour Builders',
          kind: 'file',
          itemType: 'workers_comp',
          documentId: 'cdo_01HZZZZZZZZZZZZZZZZZZZZZZ1',
          at: '2026-11-05T01:00:00Z',
        },
      ],
    }));
    renderInProject(<SharingSection />);
    expect(await screen.findByText(/Opened a file · Workers compensation/)).toBeTruthy();
  });
});
