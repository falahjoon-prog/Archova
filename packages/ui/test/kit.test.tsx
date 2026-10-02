// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ActivityTimeline,
  Checkbox,
  DataTable,
  Dialog,
  EmptyState,
  ItemHeader,
  NovaFeedback,
  NovaSuggestion,
  StatusPill,
  Switch,
  Tabs,
  Textarea,
  TextField,
  ToggleGroup,
} from '../src';

afterEach(cleanup);

describe('StatusPill', () => {
  it('always pairs the colour with an icon and a text label', () => {
    render(<StatusPill tone="danger">Overdue</StatusPill>);
    const pill = screen.getByText('Overdue').parentElement!;
    expect(pill.className).toContain('ac-pill--danger');
    expect(pill.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('inline fill marker', () => {
  it('labels Nova-filled fields', () => {
    render(
      <>
        <TextField label="Subject" aiFilled defaultValue="Slab edge set-out" />
        <Textarea label="Question" />
      </>,
    );
    expect(screen.getByText('Drafted by Nova')).toBeTruthy();
    expect(screen.getByLabelText(/Subject/).className).toContain('ac-input--ai');
    expect(screen.getByLabelText('Question').className).not.toContain('ac-input--ai');
  });
});

describe('Checkbox and Switch', () => {
  it('toggles a switch with its label', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [on, setOn] = useState(false);
      return <Switch label="Normalise" checked={on} onCheckedChange={setOn} />;
    }
    render(
      <>
        <Harness />
        <Checkbox label="Possible EOT" defaultChecked />
      </>,
    );
    const sw = screen.getByRole('switch', { name: 'Normalise' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    await user.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect((screen.getByLabelText('Possible EOT') as HTMLInputElement).checked).toBe(true);
  });
});

describe('Tabs', () => {
  it('moves selection with the arrow keys', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [tab, setTab] = useState('details');
      return (
        <Tabs
          label="RFI views"
          value={tab}
          onValueChange={setTab}
          tabs={[
            { id: 'details', label: 'Details' },
            { id: 'activity', label: 'Activity', count: 3 },
          ]}
        >
          <p>Panel {tab}</p>
        </Tabs>
      );
    }
    render(<Harness />);
    const details = screen.getByRole('tab', { name: 'Details' });
    await user.click(details);
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /Activity/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('tabpanel').textContent).toBe('Panel activity');
  });
});

describe('Dialog', () => {
  it('renders title, body and footer when open and closes from the close button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Close RFI-004" footer={<button>Close RFI</button>}>
        <p>Pick the official response.</p>
      </Dialog>,
    );
    expect(screen.getByText('Close RFI-004')).toBeTruthy();
    expect(screen.getByText('Pick the official response.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('DataTable', () => {
  const rows = [
    { id: 'a', number: 'RFI-002', due: '2026-10-09' },
    { id: 'b', number: 'RFI-010', due: '2026-10-03' },
    { id: 'c', number: 'RFI-001', due: '2026-10-20' },
  ];
  const columns = [
    {
      id: 'number',
      header: 'Number',
      cell: (r: (typeof rows)[number]) => r.number,
      sortValue: (r: (typeof rows)[number]) => r.number,
      rowHeader: true,
    },
    {
      id: 'due',
      header: 'Due',
      cell: (r: (typeof rows)[number]) => r.due,
      sortValue: (r: (typeof rows)[number]) => r.due,
    },
  ];

  it('sorts naturally and announces the sort direction', async () => {
    const user = userEvent.setup();
    render(<DataTable caption="RFIs" columns={columns} rows={rows} getRowId={(r) => r.id} />);
    await user.click(screen.getByRole('button', { name: 'Number' }));
    const firstCells = () => screen.getAllByRole('rowheader').map((c) => c.textContent);
    expect(firstCells()).toEqual(['RFI-001', 'RFI-002', 'RFI-010']);
    expect(screen.getByRole('columnheader', { name: 'Number' }).getAttribute('aria-sort')).toBe(
      'ascending',
    );
    await user.click(screen.getByRole('button', { name: 'Number' }));
    expect(firstCells()).toEqual(['RFI-010', 'RFI-002', 'RFI-001']);
  });

  it('shows the empty state in the body', () => {
    render(
      <DataTable
        caption="RFIs"
        columns={columns}
        rows={[]}
        getRowId={(r) => r.id}
        empty={<EmptyState title="No RFIs yet" />}
      />,
    );
    expect(screen.getByText('No RFIs yet')).toBeTruthy();
  });
});

describe('ItemHeader', () => {
  it('renders the number, a single h1 and the ball in court', () => {
    render(
      <ItemHeader
        number="RFI-042"
        title="Slab edge set-out at grid C"
        status={<StatusPill tone="info">Open</StatusPill>}
        ballInCourt="Waiting on: Smith Engineers · J. Smith"
      />,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Slab edge set-out at grid C',
    );
    expect(screen.getByText('RFI-042')).toBeTruthy();
    expect(screen.getByText(/Waiting on: Smith Engineers/)).toBeTruthy();
  });
});

describe('ActivityTimeline', () => {
  it('shows before and after for changes', () => {
    render(
      <ActivityTimeline
        entries={[
          {
            id: '1',
            actor: 'Priya Shah',
            action: 'changed the due date',
            change: { before: '9 Oct 2026', after: '14 Oct 2026' },
            at: '2 Oct 2026, 10:14',
            atIso: '2026-10-02T00:14:00Z',
          },
        ]}
      />,
    );
    const item = screen.getByRole('listitem');
    expect(within(item).getByText('9 Oct 2026').className).toContain('ac-timeline__before');
    expect(item.textContent).toContain('14 Oct 2026');
  });
});

describe('ToggleGroup', () => {
  it('marks the current option as pressed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ToggleGroup
        label="Tool"
        value="pan"
        onValueChange={onChange}
        options={[
          { value: 'pan', label: 'Pan' },
          { value: 'length', label: 'Length' },
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Pan' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Length' }));
    expect(onChange).toHaveBeenCalledWith('length');
  });
});

describe('NovaSuggestion', () => {
  it('labels Nova content and lists its sources', () => {
    render(
      <NovaSuggestion
        citations={[{ id: 'c1', label: 'S-201 Rev C', href: '/acme/projects/p/drawings/s' }]}
        actions={<button>Accept</button>}
      >
        Set out per S-201.
      </NovaSuggestion>,
    );
    const region = screen.getByRole('region', { name: 'Drafted by Nova' });
    expect(within(region).getByRole('link', { name: 'S-201 Rev C' }).getAttribute('href')).toBe(
      '/acme/projects/p/drawings/s',
    );
  });

  it('records feedback', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NovaFeedback value={null} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Not helpful' }));
    expect(onChange).toHaveBeenCalledWith('down');
  });
});
