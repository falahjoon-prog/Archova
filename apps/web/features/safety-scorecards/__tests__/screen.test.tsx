// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderInProject } from '@/test/render';
import { SafetyScorecardsScreen } from '../screens/SafetyScorecardsScreen';

vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

describe('Safety scorecards screen', () => {
  it('lists companies with a rating and the Nova flags', async () => {
    renderInProject(<SafetyScorecardsScreen />);
    await screen.findByRole('table', { name: 'Safety scorecards' });
    expect(await screen.findByText('High risk')).toBeTruthy();
    expect(screen.getByText('Nova suggests a closer look')).toBeTruthy();
  });
});
