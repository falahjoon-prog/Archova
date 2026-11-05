// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
const flag = vi.hoisted(() => ({ on: true }));
vi.mock('@/shared/hooks/useFeatureFlag', () => ({ useFeatureFlag: () => flag.on }));

// The project list comes from the shared query set, which the fake client leaves empty; give the screen a fixed one.
vi.mock('../hooks/useSubcontractorWallets', async (orig) => ({
  ...(await orig()),
  useProjectChoices: () => ({
    data: { data: [{ id: 'prj_01HZZZZZZZZZZZZZZZZZZZZZZ1', name: 'Wharf St' }] },
  }),
}));

const { SubcontractorWalletsScreen } = await import('../screens/SubcontractorWalletsScreen');

const O = '/v1/orgs/{orgId}';
const REQS = `${O}/compliance-access-requests`;
const WALLETS = `${O}/subcontractor-wallets`;
const DOCS = `${WALLETS}/{grantId}/documents`;
const FILE = `${DOCS}/{documentId}/files/{position}`;
const SNAP = `${WALLETS}/{grantId}/snapshots`;

const project = { id: 'prj_01HZZZZZZZZZZZZZZZZZZZZZZ1', name: 'Wharf St' };
const wallet = {
  grantId: 'cgr_01HZZZZZZZZZZZZZZZZZZZZZZ1',
  subbieName: 'Spark Electrical',
  itemTypes: ['workers_comp'],
  projectId: project.id,
  projectName: 'Wharf St',
  allProjects: false,
  expiresOn: '2027-06-30',
};
const doc = {
  id: 'cdo_01HZZZZZZZZZZZZZZZZZZZZZZ1',
  itemType: 'workers_comp',
  title: 'Workers comp 2026',
  numberLast4: '5678',
  issuingState: null,
  licenceClass: null,
  insurer: 'Acme Insurance',
  limitCents: null,
  startsOn: null,
  expiresOn: '2027-01-10',
  evidence: 'sighted',
  expiry: 'expiring',
  sightedAt: '2026-11-01T00:00:00Z',
  fileCount: 2,
};
const request = {
  id: 'car_01HZZZZZZZZZZZZZZZZZZZZZZ1',
  requesterName: 'Test User',
  projectId: project.id,
  projectName: 'Wharf St',
  allProjects: false,
  itemTypes: ['public_liability'],
  grantExpiresOn: '2027-06-30',
  codeExpiresAt: '2026-11-19T00:00:00Z',
  status: 'requested',
  version: 1,
  createdAt: '2026-11-05T00:00:00Z',
};

beforeEach(() => {
  fake.reset();
  flag.on = true;
  fake.on('GET', REQS, () => ({ data: [] }));
  fake.on('GET', WALLETS, () => ({ data: [] }));
});

describe('SubcontractorWalletsScreen', () => {
  it('says so when the flag is off', async () => {
    flag.on = false;
    renderInProject(<SubcontractorWalletsScreen />);
    expect(await screen.findByText(/aren’t switched on/)).toBeTruthy();
  });

  it('asks for a project and a document type before creating a request', async () => {
    const user = userEvent.setup();
    renderInProject(<SubcontractorWalletsScreen />);
    await user.click(await screen.findByRole('button', { name: 'Create request' }));
    expect(
      await screen.findByText(/Choose a project/, { selector: '[role="alert"], div' }),
    ).toBeTruthy();
    expect(fake.callsTo('POST', REQS)).toHaveLength(0);
  });

  it('creates a request for one project and shows the code once', async () => {
    const user = userEvent.setup();
    fake.on('POST', REQS, () => ({ request, code: 'wlt_abcd-efgh-ijkl' }));
    renderInProject(<SubcontractorWalletsScreen />);
    await screen.findByRole('option', { name: 'Wharf St' });
    await user.selectOptions(screen.getByLabelText('Project'), project.id);
    await user.click(screen.getByLabelText('Public liability insurance'));
    await user.click(screen.getByRole('button', { name: 'Create request' }));
    expect((await screen.findByTestId('share-code')).textContent).toBe('wlt_abcd-efgh-ijkl');
    expect(fake.callsTo('POST', REQS)[0]!.init.body).toEqual({
      itemTypes: ['public_liability'],
      allProjects: false,
      projectId: project.id,
    });
  });

  it('never offers a working-with-children check', async () => {
    renderInProject(<SubcontractorWalletsScreen />);
    await screen.findByRole('button', { name: 'Create request' });
    expect(screen.queryByLabelText('Working with children check')).toBeNull();
  });

  it('cancels an open request with its version', async () => {
    const user = userEvent.setup();
    fake.on('GET', REQS, () => ({ data: [request] }));
    fake.on('POST', `${REQS}/{requestId}/cancel`, () => ({ ...request, status: 'cancelled' }));
    renderInProject(<SubcontractorWalletsScreen />);
    await user.click(await screen.findByRole('button', { name: /Cancel/ }));
    await waitFor(() => expect(fake.callsTo('POST', `${REQS}/{requestId}/cancel`)).toHaveLength(1));
    expect(fake.callsTo('POST', `${REQS}/{requestId}/cancel`)[0]!.init.params?.header).toEqual({
      'If-Match': '"1"',
    });
  });

  it('reads documents through a grant, opens a file by position, and keeps a record', async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    fake.on('GET', WALLETS, () => ({ data: [wallet] }));
    fake.on('GET', DOCS, () => ({ data: [doc] }));
    fake.on('GET', FILE, () => ({
      url: 'https://files.test/x',
      expiresAt: '2026-11-05T00:01:00Z',
    }));
    fake.on('POST', SNAP, () => ({ id: 'crs_01HZZZZZZZZZZZZZZZZZZZZZZ1' }));
    renderInProject(<SubcontractorWalletsScreen />);
    await user.click(await screen.findByRole('button', { name: /View documents/ }));
    expect(await screen.findByText('Workers comp 2026')).toBeTruthy();
    expect(fake.callsTo('GET', DOCS)[0]!.init.params?.query).toEqual({ projectId: project.id });
    expect(screen.getByText(/Number ends in|ends in 5678/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/verified(?!”)/i);

    await user.click(screen.getByRole('button', { name: /Open file 2/ }));
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith('https://files.test/x', '_blank', 'noopener'),
    );
    expect(fake.callsTo('GET', FILE)[0]!.init.params?.path).toMatchObject({ position: '2' });

    await user.click(screen.getByRole('button', { name: /Keep a record/ }));
    await waitFor(() => expect(fake.callsTo('POST', SNAP)).toHaveLength(1));
    expect(fake.callsTo('POST', SNAP)[0]!.init.body).toEqual({
      grantId: wallet.grantId,
      projectId: project.id,
      documentId: doc.id,
      reason: 'site_entry',
    });
    open.mockRestore();
  });

  it('asks which project an all-projects grant is for before reading', async () => {
    const user = userEvent.setup();
    fake.on('GET', WALLETS, () => ({
      data: [{ ...wallet, projectId: null, projectName: null, allProjects: true }],
    }));
    fake.on('GET', DOCS, () => ({ data: [doc] }));
    renderInProject(<SubcontractorWalletsScreen />);
    await user.click(await screen.findByRole('button', { name: /View documents/ }));
    expect(fake.callsTo('GET', DOCS)).toHaveLength(0);
    await user.selectOptions(
      await screen.findByLabelText('Which project is this for?'),
      project.id,
    );
    expect(await screen.findByText('Workers comp 2026')).toBeTruthy();
  });
});
