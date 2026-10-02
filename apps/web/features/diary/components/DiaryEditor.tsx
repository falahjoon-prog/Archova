'use client';

import type { ReactNode } from 'react';
import { Button, Checkbox, Select, Switch, TextField, Textarea } from '@archova/ui';
import { Plus, Trash2 } from '@archova/ui/icons';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { mockId } from '@/shared/mocks/runtime';
import { eotByDefault, labourTotals } from '../lib/entry';
import {
  DELAY_TYPES,
  DELAY_TYPE_LABELS,
  type DelayType,
  type DiaryContent,
  type DiaryPhoto,
  type Weather,
} from '../lib/types';
import { WeatherSummary } from './WeatherSummary';

const num = (v: string): number | null => (v === '' ? null : Math.max(0, Number(v)));

export interface DiaryEditorProps {
  value: DiaryContent;
  onChange: (next: DiaryContent) => void;
  weather: Weather | null;
  photosToday: DiaryPhoto[];
  /** Nova blocks (summary, possible delay) rendered above the notes. */
  nova?: ReactNode;
}

/**
 * The day's sections (F1.7 step 2), each collapsible and optional. Lines keep their ids so autosave and
 * amendments work line by line, the same as the mobile sync.
 */
export function DiaryEditor({ value, onChange, weather, photosToday, nova }: DiaryEditorProps) {
  const { companies, companyName } = useProjectDirectory();
  const companyOptions = companies.map((c) => ({ value: c.id, label: c.name }));
  const set = <K extends keyof DiaryContent>(key: K, v: DiaryContent[K]) =>
    onChange({ ...value, [key]: v });
  const totals = labourTotals(value);

  const updateLine = <K extends 'labour' | 'plant' | 'deliveries' | 'visitors' | 'delays'>(
    key: K,
    id: string,
    patch: Partial<DiaryContent[K][number]>,
  ) =>
    set(
      key,
      (value[key] as Array<{ id: string }>).map((l) =>
        l.id === id ? { ...l, ...patch } : l,
      ) as DiaryContent[K],
    );
  const removeLine = (key: 'labour' | 'plant' | 'deliveries' | 'visitors' | 'delays', id: string) =>
    set(key, (value[key] as Array<{ id: string }>).filter((l) => l.id !== id) as never);

  return (
    <div className="stack diary-sections">
      <Section id="diary-weather" title="Weather">
        {weather ? (
          <WeatherSummary weather={weather} />
        ) : (
          <p className="u-muted u-m-0">No weather data for this day.</p>
        )}
        <Textarea
          label="Weather notes"
          hint="Add what you saw on site if it differs. Both are kept."
          rows={2}
          value={value.weatherNotes}
          onChange={(e) => set('weatherNotes', e.target.value)}
        />
        <Switch
          label="Site stood down"
          checked={value.standDown.active}
          onCheckedChange={(active) => set('standDown', { ...value.standDown, active })}
        />
        {value.standDown.active ? (
          <div className="stack">
            <div className="form-row">
              <TextField
                label="Stood down from"
                type="time"
                value={value.standDown.start ?? ''}
                onChange={(e) =>
                  set('standDown', { ...value.standDown, start: e.target.value || null })
                }
              />
              <TextField
                label="Until"
                type="time"
                value={value.standDown.end ?? ''}
                onChange={(e) =>
                  set('standDown', { ...value.standDown, end: e.target.value || null })
                }
              />
            </div>
            <CompanyChecks
              legend="Companies stood down"
              value={value.standDown.companyIds}
              onChange={(companyIds) => set('standDown', { ...value.standDown, companyIds })}
            />
          </div>
        ) : null}
      </Section>

      <Section
        id="diary-labour"
        title="Labour"
        summary={`${totals.headcount} people · ${totals.hours} hours`}
      >
        {value.labour.length ? (
          <div className="table-wrap">
            <table className="table diary-lines">
              <caption className="u-visually-hidden">Labour by company</caption>
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col">Trade</th>
                  <th scope="col">Headcount</th>
                  <th scope="col">Hours</th>
                  <th scope="col">
                    <span className="u-visually-hidden">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {value.labour.map((l) => {
                  const name = companyName(l.companyId);
                  return (
                    <tr key={l.id}>
                      <th scope="row">
                        <select
                          className="ac-input"
                          aria-label="Company"
                          value={l.companyId}
                          onChange={(e) =>
                            updateLine('labour', l.id, { companyId: e.target.value })
                          }
                        >
                          {companyOptions.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </th>
                      <td>
                        <input
                          className="ac-input"
                          aria-label={`${name} trade`}
                          value={l.trade}
                          onChange={(e) => updateLine('labour', l.id, { trade: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="ac-input ac-input--narrow"
                          aria-label={`${name} headcount`}
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={l.headcount ?? ''}
                          onChange={(e) =>
                            updateLine('labour', l.id, { headcount: num(e.target.value) })
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="ac-input ac-input--narrow"
                          aria-label={`${name} hours`}
                          type="number"
                          min={0}
                          step={0.5}
                          inputMode="decimal"
                          value={l.hours ?? ''}
                          onChange={(e) =>
                            updateLine('labour', l.id, { hours: num(e.target.value) })
                          }
                        />
                      </td>
                      <td>
                        <RemoveButton
                          label={`Remove ${name}`}
                          onClick={() => removeLine('labour', l.id)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={2}>
                    Total
                  </th>
                  <td>{totals.headcount}</td>
                  <td>{totals.hours}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <p className="u-muted u-m-0">No labour recorded.</p>
        )}
        <AddButton
          label="Add company"
          onClick={() =>
            set('labour', [
              ...value.labour,
              {
                id: mockId('lab'),
                companyId: (companies.find((c) => c.isBuilder) ?? companies[0])?.id ?? '',
                trade: '',
                headcount: null,
                hours: null,
              },
            ])
          }
        />
      </Section>

      <Section
        id="diary-delays"
        title="Delays"
        summary={value.delays.length ? `${value.delays.length}` : undefined}
      >
        {value.delays.map((d, i) => (
          <fieldset key={d.id} className="fieldset stack">
            <legend>Delay {i + 1}</legend>
            <div className="form-row">
              <Select
                label="Type"
                value={d.type}
                options={DELAY_TYPES.map((t) => ({ value: t, label: DELAY_TYPE_LABELS[t] }))}
                onChange={(e) => {
                  const type = e.target.value as DelayType;
                  updateLine('delays', d.id, { type, isEotCandidate: eotByDefault(type) });
                }}
              />
              <TextField
                label="Hours"
                type="number"
                min={0}
                step={0.5}
                inputMode="decimal"
                value={d.hours ?? ''}
                onChange={(e) => updateLine('delays', d.id, { hours: num(e.target.value) })}
              />
            </div>
            <Textarea
              label="What happened"
              rows={2}
              value={d.description}
              onChange={(e) => updateLine('delays', d.id, { description: e.target.value })}
            />
            <CompanyChecks
              legend="Companies affected"
              value={d.affectedCompanyIds}
              onChange={(affectedCompanyIds) => updateLine('delays', d.id, { affectedCompanyIds })}
            />
            <div className="row-actions">
              <Checkbox
                label="Possible extension of time"
                checked={d.isEotCandidate}
                onChange={(e) => updateLine('delays', d.id, { isEotCandidate: e.target.checked })}
              />
              <RemoveButton
                label={`Remove delay ${i + 1}`}
                onClick={() => removeLine('delays', d.id)}
                text
              />
            </div>
          </fieldset>
        ))}
        <AddButton
          label="Add delay"
          onClick={() =>
            set('delays', [
              ...value.delays,
              {
                id: mockId('dly'),
                type: 'weather',
                hours: null,
                description: '',
                affectedCompanyIds: [],
                isEotCandidate: eotByDefault('weather'),
              },
            ])
          }
        />
      </Section>

      <Section
        id="diary-plant"
        title="Plant"
        summary={value.plant.length ? `${value.plant.length}` : undefined}
      >
        {value.plant.map((p) => (
          <div key={p.id} className="form-row diary-line">
            <TextField
              label="Plant"
              value={p.description}
              onChange={(e) => updateLine('plant', p.id, { description: e.target.value })}
            />
            <TextField
              label="Quantity"
              type="number"
              min={1}
              value={p.quantity}
              onChange={(e) => updateLine('plant', p.id, { quantity: num(e.target.value) ?? 1 })}
            />
            <TextField
              label="Hours"
              type="number"
              min={0}
              step={0.5}
              value={p.hours ?? ''}
              onChange={(e) => updateLine('plant', p.id, { hours: num(e.target.value) })}
            />
            <Select
              label="Status"
              value={p.status}
              options={[
                { value: 'working', label: 'Working' },
                { value: 'idle', label: 'Idle' },
                { value: 'broken_down', label: 'Broken down' },
              ]}
              onChange={(e) =>
                updateLine('plant', p.id, { status: e.target.value as typeof p.status })
              }
            />
            <RemoveButton
              label={`Remove ${p.description || 'plant'}`}
              onClick={() => removeLine('plant', p.id)}
            />
          </div>
        ))}
        <AddButton
          label="Add plant"
          onClick={() =>
            set('plant', [
              ...value.plant,
              { id: mockId('plt'), description: '', quantity: 1, hours: null, status: 'working' },
            ])
          }
        />
      </Section>

      <Section
        id="diary-deliveries"
        title="Deliveries"
        summary={value.deliveries.length ? `${value.deliveries.length}` : undefined}
      >
        {value.deliveries.map((d) => (
          <div key={d.id} className="form-row diary-line">
            <TextField
              label="Supplier"
              value={d.supplier}
              onChange={(e) => updateLine('deliveries', d.id, { supplier: e.target.value })}
            />
            <TextField
              label="What was delivered"
              value={d.description}
              onChange={(e) => updateLine('deliveries', d.id, { description: e.target.value })}
            />
            <TextField
              label="Docket number"
              value={d.docketNumber}
              onChange={(e) => updateLine('deliveries', d.id, { docketNumber: e.target.value })}
            />
            <RemoveButton
              label={`Remove ${d.description || 'delivery'}`}
              onClick={() => removeLine('deliveries', d.id)}
            />
          </div>
        ))}
        <AddButton
          label="Add delivery"
          onClick={() =>
            set('deliveries', [
              ...value.deliveries,
              {
                id: mockId('del'),
                supplier: '',
                description: '',
                docketNumber: '',
                receivedAt: null,
              },
            ])
          }
        />
      </Section>

      <Section
        id="diary-visitors"
        title="Visitors"
        summary={value.visitors.length ? `${value.visitors.length}` : undefined}
      >
        {value.visitors.map((v) => (
          <div key={v.id} className="form-row diary-line">
            <TextField
              label="Name"
              value={v.name}
              onChange={(e) => updateLine('visitors', v.id, { name: e.target.value })}
            />
            <TextField
              label="Company"
              value={v.company}
              onChange={(e) => updateLine('visitors', v.id, { company: e.target.value })}
            />
            <TextField
              label="Purpose"
              value={v.purpose}
              onChange={(e) => updateLine('visitors', v.id, { purpose: e.target.value })}
            />
            <RemoveButton
              label={`Remove ${v.name || 'visitor'}`}
              onClick={() => removeLine('visitors', v.id)}
            />
          </div>
        ))}
        <AddButton
          label="Add visitor"
          onClick={() =>
            set('visitors', [
              ...value.visitors,
              { id: mockId('vis'), name: '', company: '', purpose: '' },
            ])
          }
        />
      </Section>

      <Section id="diary-notes" title="Notes">
        {nova}
        <Textarea
          label="Notes"
          rows={5}
          value={value.notes}
          onChange={(e) => set('notes', e.target.value)}
        />
      </Section>

      <Section
        id="diary-photos"
        title="Photos"
        summary={value.photoIds.length ? `${value.photoIds.length}` : undefined}
      >
        {photosToday.length ? (
          <fieldset className="fieldset">
            <legend>Photos taken on this project today</legend>
            <div className="check-grid">
              {photosToday.map((p) => (
                <Checkbox
                  key={p.id}
                  label={p.caption}
                  checked={value.photoIds.includes(p.id)}
                  onChange={(e) =>
                    set(
                      'photoIds',
                      e.target.checked
                        ? [...value.photoIds, p.id]
                        : value.photoIds.filter((id) => id !== p.id),
                    )
                  }
                />
              ))}
            </div>
          </fieldset>
        ) : (
          <p className="u-muted u-m-0">No photos taken on this project today.</p>
        )}
      </Section>
    </div>
  );
}

function Section({
  id,
  title,
  summary,
  children,
}: {
  id: string;
  title: string;
  summary?: string | undefined;
  children: ReactNode;
}) {
  return (
    <details id={id} className="diary-section" open>
      <summary className="diary-section__summary">
        <h2 className="diary-section__title">{title}</h2>
        {summary ? <span className="u-caption">{summary}</span> : null}
      </summary>
      <div className="stack diary-section__body">{children}</div>
    </details>
  );
}

function CompanyChecks({
  legend,
  value,
  onChange,
}: {
  legend: string;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const { companies } = useProjectDirectory();
  return (
    <fieldset className="fieldset">
      <legend>{legend}</legend>
      <div className="check-grid">
        {companies.map((c) => (
          <Checkbox
            key={c.id}
            label={c.name}
            checked={value.includes(c.id)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, c.id] : value.filter((id) => id !== c.id))
            }
          />
        ))}
      </div>
    </fieldset>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div>
      <Button type="button" variant="secondary" size="sm" onClick={onClick}>
        <Plus size={16} aria-hidden="true" /> {label}
      </Button>
    </div>
  );
}

function RemoveButton({
  label,
  onClick,
  text,
}: {
  label: string;
  onClick: () => void;
  text?: boolean;
}) {
  return text ? (
    <Button type="button" variant="tertiary" size="sm" onClick={onClick}>
      {label}
    </Button>
  ) : (
    <Button
      type="button"
      variant="tertiary"
      size="sm"
      iconOnly
      aria-label={label}
      onClick={onClick}
    >
      <Trash2 size={16} aria-hidden="true" />
    </Button>
  );
}
