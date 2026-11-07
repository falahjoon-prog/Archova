// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nav, renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);
// The canvas needs WebGL; here it is a button that "picks" the first element of the first model.
vi.mock('next/dynamic', () => ({
  default:
    () =>
    (p: {
      models: { modelId: string; elements: { expressId: number }[] }[];
      onPick: (r: unknown) => void;
    }) =>
      createElement(
        'button',
        {
          onClick: () =>
            p.onPick({
              modelId: p.models[0]!.modelId,
              expressId: p.models[0]!.elements[0]!.expressId,
            }),
        },
        'Pick an element',
      ),
}));
vi.mock('@/shared/lib/uploads', () => ({
  uploadFile: vi.fn(),
  fileDownloadUrl: vi.fn(async () => 'https://files.example/model.ifc'),
}));
const box = (min: [number, number, number], max: [number, number, number]) => ({ min, max });
vi.mock('../viewer/ifc', () => ({
  friendlyType: (t: string) => t,
  createIfcApi: vi.fn(async () => ({})),
  parseIfc: vi.fn((_api: unknown, bytes: Uint8Array) =>
    bytes[0] === 1
      ? [
          {
            expressId: 7,
            guid: 'WALLGUID',
            name: 'Wall A',
            ifcType: 'IFCWALL',
            parts: [],
            box: box([0, 0, 0], [4, 3, 0.4]),
          },
        ]
      : [
          {
            expressId: 9,
            guid: 'DUCTGUID',
            name: 'Duct B',
            ifcType: 'IFCDUCTSEGMENT',
            parts: [],
            box: box([1, 1, -0.1], [3, 1.3, 0.2]),
          },
        ],
  ),
}));

const { ModelViewerScreen } = await import('../screens/ModelViewerScreen');

const M = '/v1/orgs/{orgId}/projects/{projectId}/bim-models';
const L = '/v1/orgs/{orgId}/projects/{projectId}/coordination-issues';
const model = (id: string, name: string, fileId: string | null) => ({
  id,
  projectId: 'prj_test',
  name,
  discipline: 'architectural',
  versionLabel: 'Rev A',
  fileId,
  status: 'current',
  supersededById: null,
  version: 1,
  createdAt: '2026-11-05T00:00:00Z',
});

beforeEach(() => {
  fake.reset();
  nav.search = '';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([url.includes('model') ? 1 : 1]).buffer,
    })),
  );
});

describe('ModelViewerScreen', () => {
  it('says so when no model has a file', async () => {
    fake.on('GET', M, () => ({ data: [model('bmd_1', 'Arch', null)] }));
    renderInProject(<ModelViewerScreen />);
    expect(await screen.findByText('No model files yet')).toBeTruthy();
  });

  it('opens a model, shows the picked element and raises an issue pinned to it', async () => {
    fake.on('GET', M, () => ({ data: [model('bmd_1', 'Arch', 'fil_1')] }));
    const post = vi.fn(() => ({ issue: { id: 'cis_1', number: 4 }, comments: [] }));
    fake.on('POST', L, post);
    renderInProject(<ModelViewerScreen />);
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText(/^Arch/));
    await user.click(screen.getByRole('button', { name: 'Open in 3D' }));
    await user.click(await screen.findByRole('button', { name: 'Pick an element' }));
    expect(await screen.findByText('WALLGUID')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Raise an issue' }));
    await user.click(screen.getByRole('button', { name: 'Raise issue' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = (post.mock.calls[0] as unknown as [{ body: Record<string, unknown> }])[0].body;
    expect(body).toMatchObject({
      modelId: 'bmd_1',
      elementGuids: ['WALLGUID'],
      title: 'Wall A (Arch)',
    });
    expect(await screen.findByText(/Issue 4 raised/)).toBeTruthy();
  });

  it('checks two models for clashes and pins the issue to both elements', async () => {
    fake.on('GET', M, () => ({
      data: [model('bmd_1', 'Arch', 'fil_1'), model('bmd_2', 'Mech', 'fil_2')],
    }));
    const post = vi.fn(() => ({ issue: { id: 'cis_2', number: 5 }, comments: [] }));
    fake.on('POST', L, post);
    const ifc = await import('../viewer/ifc');
    // First model returns the wall, second the duct.
    let n = 0;
    vi.mocked(ifc.parseIfc).mockImplementation(() =>
      n++ === 0
        ? [
            {
              expressId: 7,
              guid: 'WALLGUID',
              name: 'Wall A',
              ifcType: 'IFCWALL',
              parts: [],
              box: box([0, 0, 0], [4, 3, 0.4]),
            },
          ]
        : [
            {
              expressId: 9,
              guid: 'DUCTGUID',
              name: 'Duct B',
              ifcType: 'IFCDUCT',
              parts: [],
              box: box([1, 1, -0.1], [3, 1.3, 0.2]),
            },
          ],
    );
    renderInProject(<ModelViewerScreen />);
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText(/^Arch/));
    await user.click(screen.getByLabelText(/^Mech/));
    await user.click(screen.getByRole('button', { name: 'Open in 3D' }));
    await user.click(await screen.findByRole('button', { name: 'Check for clashes' }));
    const row = await screen.findByRole('button', { name: /Wall A \(Arch\) × Duct B \(Mech\)/ });
    await user.click(row);
    await user.click(screen.getByRole('button', { name: 'Raise an issue' }));
    await user.click(screen.getByRole('button', { name: 'Raise issue' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = (post.mock.calls[0] as unknown as [{ body: Record<string, unknown> }])[0].body;
    expect(body.elementGuids).toEqual(['WALLGUID', 'DUCTGUID']);
  });
});
