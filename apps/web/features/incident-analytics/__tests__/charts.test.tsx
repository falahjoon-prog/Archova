// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BodyMap } from '../components/BodyMap';
import { BarList, DaysGauge, Donut } from '../components/Charts';
import { harmSourceColour, heatColour, injuryTypeColour } from '../lib/colours';

describe('colours', () => {
  it('keeps a category on its own colour and folds the tail into grey', () => {
    expect(harmSourceColour('falls_trips_slips')).toBe('var(--ia-s1)');
    expect(harmSourceColour('other')).toBe('var(--ia-other)');
    expect(injuryTypeColour('laceration')).toBe('var(--ia-s2)');
  });
  it('shades from the busiest part', () => {
    expect(heatColour(0, 4)).toBe('var(--ia-seq-0)');
    expect(heatColour(4, 4)).toBe('var(--ia-seq-5)');
    expect(heatColour(1, 4)).toBe('var(--ia-seq-2)');
  });
});

describe('BodyMap', () => {
  it('shades a part, names its count and filters on click', async () => {
    const onSelect = vi.fn();
    render(
      <BodyMap
        byBodyPart={[
          { key: 'hand', count: 3 },
          { key: 'knee', count: 1 },
        ]}
        selected=""
        onSelect={onSelect}
      />,
    );
    const hands = screen.getAllByRole('button', { name: 'Hand: 3 injuries' });
    expect(hands).toHaveLength(2); // front and back
    expect(hands[0]!.getAttribute('style')).toContain('--ia-seq-5');
    await userEvent.click(hands[0]!);
    expect(onSelect).toHaveBeenCalledWith('hand');
  });
});

describe('charts', () => {
  const items = [
    { key: 'falls_trips_slips', count: 3 },
    { key: 'other', count: 1 },
  ];
  it('draws bars and a donut with coloured fills', () => {
    const { container } = render(
      <>
        <BarList items={items} label={(k) => k} colour={harmSourceColour} />
        <Donut items={items} label={(k) => k} colour={harmSourceColour} />
      </>,
    );
    expect(container.querySelector('.ia-bars__fill')!.getAttribute('style')).toContain(
      'var(--ia-s1)',
    );
    expect(container.querySelectorAll('circle').length).toBe(2);
  });
  it('shows the days and a message when none is recorded', () => {
    render(<DaysGauge title="Days without an injury" value={12} noneText="None" />);
    expect(screen.getByText('12')).toBeTruthy();
    render(
      <DaysGauge title="Days without an incident" value={null} noneText="No incident recorded" />,
    );
    expect(screen.getByText('No incident recorded')).toBeTruthy();
  });
});
