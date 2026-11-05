// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nav, renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => ({ ...fake.module, ensureCsrfToken: async () => {} }));
vi.mock('@/shared/lib/uploads', () => ({ uploadFile: async () => ({ id: 'fil_1' }) }));
vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

const { ImportsScreen } = await import('../screens/ImportsScreen');

const B = '/v1/orgs/{orgId}/projects/{projectId}/import-jobs';
const job = (over = {}) => ({
  id: 'imp_1',
  projectId: 'prj_test',
  entity: 'defect',
  source: 'spreadsheet',
  fileId: 'fil_1',
  status: 'parsed',
  headerRow: 1,
  headers: ['Ref', 'Status'],
  mapping: { columns: {}, values: {} },
  totalRows: 2,
  validRows: 0,
  invalidRows: 0,
  startedBy: 'usr_1',
  createdAt: '2026-11-04T01:00:00Z',
  updatedAt: '2026-11-04T01:00:00Z',
  finishedAt: null,
  version: 3,
  ...over,
});
const row = (n: number, raw: string[], over = {}) => ({
  id: `row_${n}`,
  rowNumber: n,
  raw,
  normalised: null,
  sourceRef: raw[0],
  status: 'staged',
  errors: [],
  createdEntityId: null,
  ...over,
});
const suggestion = {
  runId: 'air_1',
  suggestionId: 'ais_1',
  entity: 'defect',
  fields: [
    { key: 'title', label: 'Title', kind: 'text', required: true, values: [] },
    {
      key: 'status',
      label: 'Status',
      kind: 'enum',
      required: false,
      values: [{ value: 'open', label: 'Open' }],
    },
  ],
  columns: [
    {
      index: 0,
      header: 'Ref',
      field: 'title',
      confidence: 'high',
      examples: ['D-1'],
      warning: null,
    },
    {
      index: 1,
      header: 'Status',
      field: 'status',
      confidence: 'high',
      examples: ['Open'],
      warning: null,
    },
  ],
  values: [{ index: 1, field: 'status', pairs: [{ source: 'Open', value: 'open' }] }],
  missingRequired: [],
};

beforeEach(() => {
  fake.reset();
  nav.search = '';
});

describe('ImportsScreen', () => {
  it('lists imports', async () => {
    fake.on('GET', B, () => ({ data: [job()], nextCursor: null }));
    renderInProject(<ImportsScreen />);
    expect(await screen.findByRole('table', { name: 'Imports' })).toBeTruthy();
    expect(screen.getByText('Read, needs mapping')).toBeTruthy();
  });

  it('suggests a mapping, saves it and shows the rows with problems', async () => {
    const user = userEvent.setup();
    nav.search = 'id=imp_1';
    let current = job();
    fake.on('GET', `${B}/{importJobId}`, () => current);
    fake.on('GET', `${B}/{importJobId}/rows`, (init) =>
      init.params?.query?.status === 'invalid'
        ? {
            data: [
              row(2, ['D-2', 'Weird'], {
                status: 'invalid',
                errors: [{ field: 'status', message: 'Status "Weird" is not one we know' }],
              }),
            ],
            nextCursor: null,
          }
        : { data: [row(1, ['D-1', 'Open']), row(2, ['D-2', 'Weird'])], nextCursor: null },
    );
    fake.on('POST', '/v1/orgs/{orgId}/projects/{projectId}/ai/import-mappings', () => suggestion);
    fake.on('PUT', `${B}/{importJobId}/mapping`, () => {
      current = job({ status: 'validated', version: 4, validRows: 1, invalidRows: 1 });
      return current;
    });
    renderInProject(<ImportsScreen />);
    await user.click(await screen.findByRole('button', { name: 'Suggest matches' }));
    const suggestCall = fake.callsTo(
      'POST',
      '/v1/orgs/{orgId}/projects/{projectId}/ai/import-mappings',
    )[0]!;
    expect((suggestCall.init.body as { columns: unknown[] }).columns).toHaveLength(2);
    await user.click(await screen.findByRole('button', { name: 'Save and check rows' }));
    await waitFor(() => expect(fake.callsTo('PUT', `${B}/{importJobId}/mapping`)).toHaveLength(1));
    const put = fake.callsTo('PUT', `${B}/{importJobId}/mapping`)[0]!;
    expect(put.init.params!.header).toEqual({ 'If-Match': '"3"' });
    expect(put.init.body).toEqual({
      columns: { title: 0, status: 1 },
      values: { status: { Open: 'open' } },
    });
    expect(await screen.findByText('Status "Weird" is not one we know')).toBeTruthy();
    expect(screen.getByText(/Nothing has been created/)).toBeTruthy();
  });

  it('will not save while a required field has no column', async () => {
    const user = userEvent.setup();
    nav.search = 'id=imp_1';
    fake.on('GET', `${B}/{importJobId}`, () => job());
    fake.on('GET', `${B}/{importJobId}/rows`, () => ({
      data: [row(1, ['D-1', 'Open'])],
      nextCursor: null,
    }));
    fake.on('POST', '/v1/orgs/{orgId}/projects/{projectId}/ai/import-mappings', () => ({
      ...suggestion,
      columns: [{ ...suggestion.columns[0]!, field: null }, suggestion.columns[1]!],
    }));
    renderInProject(<ImportsScreen />);
    await user.click(await screen.findByRole('button', { name: 'Suggest matches' }));
    expect(await screen.findByText('Some required fields have no column')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Save and check rows' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
