// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderInProject } from '@/test/render';
import type { SafetyEvidencePack } from '../data/api';
import { EvidencePackScreen } from '../screens/EvidencePackScreen';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

const section = (rows: unknown[] = [], restricted = false) => ({
  restricted,
  truncated: false,
  rows,
});
const pack: SafetyEvidencePack = {
  project: { name: 'Harbour Tower', number: null, timeZone: 'Australia/Sydney' },
  from: '2026-10-23',
  to: '2026-11-21',
  generatedOn: '2026-11-21',
  incidents: section([{ ref: 'INC-0001' }]),
  actions: section(),
  pretasks: section(),
  toolbox: section(),
  inductions: section([], true),
  inspections: section(),
  gaps: [
    {
      section: 'incidents',
      severity: 'high',
      message: 'INC-0001 is notifiable but no regulator notification time is recorded.',
    },
  ],
} as unknown as SafetyEvidencePack;

const calls = vi.hoisted(() => ({ pack: vi.fn() }));
vi.mock('../data/api', () => ({
  createEvidenceApi: () => ({ pack: calls.pack, pdf: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  calls.pack.mockReset();
});

describe('EvidencePackScreen', () => {
  it('shows what Nova found and which sections were left out', async () => {
    calls.pack.mockResolvedValue(pack);
    renderInProject(<EvidencePackScreen />);
    const gaps = await screen.findByRole('table', { name: 'Gaps found before export' });
    expect(within(gaps).getByText(/INC-0001 is notifiable/)).toBeTruthy();
    const contents = screen.getByRole('table', { name: 'Pack contents' });
    expect(within(contents).getByText('No access')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Download PDF/ })).toBeTruthy();
    expect(calls.pack).toHaveBeenCalledOnce();
  });

  it('says nothing stands out when there are no gaps', async () => {
    calls.pack.mockResolvedValue({ ...pack, gaps: [] });
    renderInProject(<EvidencePackScreen />);
    expect(await screen.findByText('Nothing stands out')).toBeTruthy();
  });
});
