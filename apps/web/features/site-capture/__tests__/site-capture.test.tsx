// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPTURE_FRAME_SOURCES } from '@archova/domain';
import { nav, renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => ({ ...fake.module, ensureCsrfToken: vi.fn(async () => {}) }));
vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);
vi.mock('@/shared/lib/uploads', () => ({
  uploadFile: vi.fn(async () => ({ id: 'fil_still' })),
  fileDownloadUrl: vi.fn(),
}));

const { SiteCaptureScreen } = await import('../screens/SiteCaptureScreen');
const { default: nextConfig } = await import('../../../next.config');

const C = '/v1/orgs/{orgId}/projects/{projectId}/site-captures';
const OBS = '/v1/orgs/{orgId}/projects/{projectId}/ai/captures/observations';
const SCAN = '/v1/orgs/{orgId}/projects/{projectId}/ai/captures/view-scans';
const REVIEW = `${OBS}/{observationId}/review`;
const ISSUES = '/v1/orgs/{orgId}/projects/{projectId}/coordination-issues';

const capture = {
  id: 'scp_1',
  projectId: 'prj_test',
  title: 'Level 3 walkthrough',
  provider: 'matterport',
  url: 'https://my.matterport.com/show/?m=AbCd',
  capturedOn: '2026-11-05',
  area: 'Level 3 east',
  note: '',
  rfiId: null,
  issueId: null,
  version: 1,
  createdAt: '2026-11-05T00:00:00Z',
  updatedAt: '2026-11-05T00:00:00Z',
};
const observation = {
  id: 'aco_1',
  fileId: 'fil_still',
  category: 'fire_stopping',
  categoryLabel: 'Missing or incomplete fire-stopping',
  observation: 'The still shows a pipe through the wall with a gap around it.',
  confidence: 'medium',
  status: 'open',
  reviewNote: null,
  reviewedAt: null,
  createdAt: '2026-11-05T00:00:00Z',
};

beforeEach(() => {
  fake.reset();
  nav.search = '';
  fake.on('GET', '/v1/orgs/{orgId}/projects/{projectId}/rfis', () => ({ data: [] }));
});

describe('SiteCaptureScreen', () => {
  it('embeds the tour from its share link and says Nova reads a still, not the tour', async () => {
    fake.on('GET', C, () => ({ data: [capture] }));
    fake.on('GET', OBS, () => ({ data: [] }));
    renderInProject(<SiteCaptureScreen />);
    const frame = await screen.findByTitle('360 tour: Level 3 walkthrough');
    expect(frame.getAttribute('src')).toBe('https://my.matterport.com/show/?m=AbCd');
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts');
    expect(await screen.findByText('Nova reads a still, not the live tour')).toBeTruthy();
  });

  it('adds a capture by share link', async () => {
    fake.on('GET', C, () => ({ data: [] }));
    fake.on('GET', OBS, () => ({ data: [] }));
    const post = vi.fn(() => capture);
    fake.on('POST', C, post);
    renderInProject(<SiteCaptureScreen />);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Add a capture' }))[0]!);
    await user.type(screen.getByLabelText('Title'), 'Level 3 walkthrough');
    await user.type(screen.getByLabelText('Share link'), 'https://my.matterport.com/show/?m=AbCd');
    await user.click(screen.getByRole('button', { name: 'Add capture' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = (post.mock.calls[0] as unknown as [{ body: Record<string, unknown> }])[0].body;
    expect(body).toMatchObject({
      title: 'Level 3 walkthrough',
      url: 'https://my.matterport.com/show/?m=AbCd',
    });
  });

  it('sends an uploaded still to Nova, then confirms what it noticed and raises an issue', async () => {
    fake.on('GET', C, () => ({ data: [capture] }));
    let open = [] as unknown[];
    fake.on('GET', OBS, () => ({ data: open }));
    fake.on('POST', SCAN, () => {
      open = [observation];
      return {
        runId: 'air_1',
        scanId: 'acs_1',
        observations: [observation],
        stillUnclear: false,
        dropped: 0,
        unsupportedNumbers: [],
        disclaimer: 'Nova read the still you uploaded, not the live 360 tour.',
      };
    });
    fake.on('POST', REVIEW, () => ({ ...observation, status: 'confirmed' }));
    const raise = vi.fn(() => ({ issue: { id: 'cis_9', number: 9 }, comments: [] }));
    fake.on('POST', ISSUES, raise);
    fake.on('PATCH', `${C}/{captureId}`, () => ({ ...capture, issueId: 'cis_9', version: 2 }));
    renderInProject(<SiteCaptureScreen />);
    const user = userEvent.setup();
    const file = new File([new Uint8Array([1])], 'view.png', { type: 'image/png' });
    await user.upload(await screen.findByLabelText('Screenshot of the view'), file);
    await user.click(screen.getByRole('button', { name: 'Ask Nova' }));
    expect(await screen.findByText(/not the live 360 tour/)).toBeTruthy();
    await user.click(await screen.findByRole('button', { name: 'Confirm and raise an issue' }));
    await waitFor(() => expect(raise).toHaveBeenCalled());
    const body = (raise.mock.calls[0] as unknown as [{ body: Record<string, unknown> }])[0].body;
    expect(body).toMatchObject({ location: 'Level 3 east' });
    expect(String(body.title)).toContain('Missing or incomplete fire-stopping');
    expect(await screen.findByText(/Issue 9 raised/)).toBeTruthy();
  });

  it('refuses a file Nova cannot read before sending anything', async () => {
    fake.on('GET', C, () => ({ data: [capture] }));
    fake.on('GET', OBS, () => ({ data: [] }));
    renderInProject(<SiteCaptureScreen />);
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(
      await screen.findByLabelText('Screenshot of the view'),
      new File(['x'], 'view.gif', { type: 'image/gif' }),
    );
    expect(await screen.findByText('Use a PNG, JPEG or WebP image.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ask Nova' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('content security policy', () => {
  it('lets the app frame every host a capture link may use, and nothing else', async () => {
    const rules = (await nextConfig.headers!()) as { headers: { key: string; value: string }[] }[];
    const csp = rules
      .flatMap((r) => r.headers)
      .find((h) => h.key === 'Content-Security-Policy')!.value;
    const frameSrc = csp.split('; ').find((d) => d.startsWith('frame-src '))!;
    const allowed = frameSrc.replace('frame-src ', '').split(' ');
    for (const source of CAPTURE_FRAME_SOURCES) expect(allowed).toContain(source);
    expect(allowed.filter((s) => s !== "'self'").sort()).toEqual([...CAPTURE_FRAME_SOURCES].sort());
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
