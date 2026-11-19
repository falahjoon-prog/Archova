'use client';

import { useState } from 'react';
import { atLeast } from '@archova/domain/permissions';
import {
  Alert,
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  Tabs,
  TextField,
  Textarea,
  type DataTableColumn,
  type StatusTone,
} from '@archova/ui';
import { GeotechIcon, Plus } from '@archova/ui/icons';
import type { LocalDate } from '@archova/time';
import { usePublishAssistantScope } from '@/features/assistant';
import { useProjectPermissions } from '@/features/projects';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import {
  useEarthworks,
  useEarthworksSummary,
  useGeotechFlags,
  useGeotechMutations,
  useGeotechTests,
  useInvestigations,
} from '../hooks/useGeotech';
import {
  EARTHWORKS_KINDS,
  EARTHWORKS_LABELS,
  INVESTIGATION_KINDS,
  INVESTIGATION_LABELS,
  OUTCOME_LABELS,
  TEST_KINDS,
  TEST_LABELS,
  TEST_UNITS,
  type EarthworksEntry,
  type EarthworksInput,
  type EarthworksKind,
  type GeotechTest,
  type Investigation,
  type InvestigationInput,
  type InvestigationKind,
  type TestInput,
  type TestKind,
  type TestOutcome,
} from '../lib/types';

const TABS = [
  { id: 'investigations', label: 'Investigations' },
  { id: 'tests', label: 'Test results' },
  { id: 'earthworks', label: 'Earthworks' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const OUTCOME_TONE: Record<TestOutcome, StatusTone> = {
  pass: 'success',
  fail: 'danger',
  no_spec: 'neutral',
};

const day = (d: string | null) => (d ? formatLocalDate(d as LocalDate) : '—');
const num = (v: number | null, unit = '') => (v === null ? '—' : `${v}${unit ? ` ${unit}` : ''}`);
const m3 = (v: number) => `${v.toLocaleString('en-AU')} m³`;
const optNum = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));
const todayIso = () => new Date().toISOString().slice(0, 10);

/** Site investigations, material test results and earthworks quantities for the project, with Nova's flags. */
export function GeotechScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const perms = useProjectPermissions(org.orgId, project.projectId);
  const canManage =
    org.role === 'owner' ||
    org.role === 'admin' ||
    atLeast(perms.data?.toolLevels.inspections, 'admin');
  const [params, setParams] = useUrlState(['tab'] as const);
  const tab: TabId = TABS.some((t) => t.id === params.tab)
    ? (params.tab as TabId)
    : 'investigations';
  const flags = useGeotechFlags();
  const m = useGeotechMutations();
  const [adding, setAdding] = useState<TabId | null>(null);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'geotech', id: 'register' },
  });

  const addLabel =
    tab === 'investigations'
      ? 'Add investigation'
      : tab === 'tests'
        ? 'Add test result'
        : 'Add volume';
  return (
    <>
      <PageHeader
        eyebrow="Quality and safety"
        title="Civil and geotech"
        description="Boreholes and test pits with their logs, soil and material test results judged against the limits you type, and cut and fill volumes by zone. Archova records the numbers; it doesn't certify them."
        actions={
          canManage ? (
            <Button onClick={() => setAdding(tab)}>
              <Plus size={16} aria-hidden="true" /> {addLabel}
            </Button>
          ) : null
        }
      />
      {previewDataOnly ? <PreviewDataNotice tool="Civil and geotech" /> : null}
      {(flags.data ?? []).length > 0 ? (
        <Card title="Needs attention" actions={<StatusPill tone="ai">Nova flags</StatusPill>}>
          <ul className="plain-list">
            {(flags.data ?? []).map((f, i) => (
              <li key={`${f.kind}-${f.refId ?? i}`}>
                <Alert tone={f.severity === 'high' ? 'danger' : 'warning'} title={f.title}>
                  {f.detail}
                </Alert>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Tabs
        label="Civil and geotech"
        tabs={TABS}
        value={tab}
        onValueChange={(id) => setParams({ tab: id })}
      >
        {tab === 'investigations' ? <InvestigationsTab /> : null}
        {tab === 'tests' ? (
          <TestsTab canManage={canManage} onDelete={(t) => m.deleteTest.mutate(t.id)} />
        ) : null}
        {tab === 'earthworks' ? (
          <EarthworksTab canManage={canManage} onDelete={(e) => m.deleteEarthworks.mutate(e.id)} />
        ) : null}
      </Tabs>
      <ErrorAlert
        error={m.deleteTest.error ?? m.deleteEarthworks.error}
        title="We couldn't remove that"
      />
      {adding === 'investigations' ? (
        <InvestigationDialog
          pending={m.createInvestigation.isPending}
          error={m.createInvestigation.error}
          onClose={() => setAdding(null)}
          onSave={(i) => m.createInvestigation.mutate(i, { onSuccess: () => setAdding(null) })}
        />
      ) : null}
      {adding === 'tests' ? (
        <TestDialog
          pending={m.createTest.isPending}
          error={m.createTest.error}
          onClose={() => setAdding(null)}
          onSave={(i) => m.createTest.mutate(i, { onSuccess: () => setAdding(null) })}
        />
      ) : null}
      {adding === 'earthworks' ? (
        <EarthworksDialog
          pending={m.createEarthworks.isPending}
          error={m.createEarthworks.error}
          onClose={() => setAdding(null)}
          onSave={(i) => m.createEarthworks.mutate(i, { onSuccess: () => setAdding(null) })}
        />
      ) : null}
    </>
  );
}

function InvestigationsTab() {
  const list = useInvestigations();
  const columns: DataTableColumn<Investigation>[] = [
    {
      id: 'number',
      header: 'No.',
      rowHeader: true,
      sortValue: (i) => i.numberLabel,
      cell: (i) => i.numberLabel,
    },
    {
      id: 'title',
      header: 'Investigation',
      sortValue: (i) => i.title,
      cell: (i) => (
        <>
          {i.title}
          {i.location ? <div className="u-muted">{i.location}</div> : null}
        </>
      ),
    },
    {
      id: 'kind',
      header: 'Type',
      sortValue: (i) => i.kind,
      cell: (i) => INVESTIGATION_LABELS[i.kind],
    },
    {
      id: 'depth',
      header: 'Depth',
      align: 'end',
      sortValue: (i) => i.depthM,
      cell: (i) => num(i.depthM, 'm'),
    },
    {
      id: 'water',
      header: 'Groundwater',
      align: 'end',
      sortValue: (i) => i.groundwaterDepthM,
      cell: (i) => num(i.groundwaterDepthM, 'm'),
    },
    {
      id: 'on',
      header: 'Date',
      sortValue: (i) => i.investigatedOn,
      cell: (i) => day(i.investigatedOn),
    },
    {
      id: 'report',
      header: 'Log or report',
      cell: (i) =>
        i.fileIds.length > 0 ? (
          <StatusPill tone="success">Attached</StatusPill>
        ) : (
          <StatusPill tone="warning">Missing</StatusPill>
        ),
    },
  ];
  return (
    <>
      <ErrorAlert error={list.error} title="We couldn't load investigations" />
      {list.isPending ? (
        <SkeletonRows label="Loading investigations…" />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState
          icon={GeotechIcon}
          title="No site investigations yet"
          description="Record boreholes, test pits and CPTs, and attach the consultant's logs and report."
        />
      ) : (
        <DataTable
          caption="Site investigations"
          columns={columns}
          rows={list.data ?? []}
          getRowId={(i) => i.id}
        />
      )}
    </>
  );
}

function TestsTab({
  canManage,
  onDelete,
}: {
  canManage: boolean;
  onDelete: (t: GeotechTest) => void;
}) {
  const [params, setParams] = useUrlState(['result'] as const);
  const result = (['pass', 'fail', 'no_spec'] as const).find((r) => r === params.result);
  const list = useGeotechTests({ result });
  const columns: DataTableColumn<GeotechTest>[] = [
    { id: 'on', header: 'Tested', sortValue: (t) => t.testedOn, cell: (t) => day(t.testedOn) },
    {
      id: 'kind',
      header: 'Test',
      rowHeader: true,
      sortValue: (t) => t.kind,
      cell: (t) => TEST_LABELS[t.kind],
    },
    {
      id: 'sample',
      header: 'Sample',
      sortValue: (t) => t.sampleRef,
      cell: (t) => (
        <>
          {t.sampleRef ?? '—'}
          {t.zone ? <div className="u-muted">{t.zone}</div> : null}
        </>
      ),
    },
    {
      id: 'value',
      header: 'Result',
      align: 'end',
      sortValue: (t) => t.value,
      cell: (t) => `${t.value}${t.unit ? ` ${t.unit}` : ''}`,
    },
    {
      id: 'spec',
      header: 'Limits',
      align: 'end',
      cell: (t) =>
        t.specMin === null && t.specMax === null
          ? '—'
          : `${t.specMin !== null ? `min ${t.specMin}` : ''}${t.specMin !== null && t.specMax !== null ? ', ' : ''}${t.specMax !== null ? `max ${t.specMax}` : ''}`,
    },
    {
      id: 'result',
      header: 'Outcome',
      sortValue: (t) => t.result,
      cell: (t) => (
        <StatusPill tone={OUTCOME_TONE[t.result]}>{OUTCOME_LABELS[t.result]}</StatusPill>
      ),
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: <span className="u-visually-hidden">Actions</span>,
            cell: (t: GeotechTest) => (
              <Button
                variant="tertiary"
                aria-label={`Remove ${TEST_LABELS[t.kind]} ${t.sampleRef ?? t.testedOn}`}
                onClick={() => onDelete(t)}
              >
                Remove
              </Button>
            ),
          } satisfies DataTableColumn<GeotechTest>,
        ]
      : []),
  ];
  return (
    <>
      <div className="filter-row">
        <Select
          label="Outcome"
          value={params.result}
          placeholder="Any outcome"
          options={(['pass', 'fail', 'no_spec'] as const).map((v) => ({
            value: v,
            label: OUTCOME_LABELS[v],
          }))}
          onChange={(e) => setParams({ result: e.target.value })}
        />
      </div>
      <ErrorAlert error={list.error} title="We couldn't load test results" />
      {list.isPending ? (
        <SkeletonRows label="Loading test results…" />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState
          icon={GeotechIcon}
          title={result ? 'No results match' : 'No test results yet'}
          description={
            result
              ? 'Try a different outcome.'
              : 'Enter CBR, density, moisture and other results with the spec limits to see which are outside range.'
          }
        />
      ) : (
        <DataTable
          caption="Test results"
          columns={columns}
          rows={list.data ?? []}
          getRowId={(t) => t.id}
        />
      )}
    </>
  );
}

function EarthworksTab({
  canManage,
  onDelete,
}: {
  canManage: boolean;
  onDelete: (e: EarthworksEntry) => void;
}) {
  const list = useEarthworks();
  const summary = useEarthworksSummary();
  const zones = summary.data?.zones ?? [];
  const columns: DataTableColumn<EarthworksEntry>[] = [
    { id: 'on', header: 'Date', sortValue: (e) => e.recordedOn, cell: (e) => day(e.recordedOn) },
    { id: 'zone', header: 'Zone', rowHeader: true, sortValue: (e) => e.zone, cell: (e) => e.zone },
    {
      id: 'kind',
      header: 'Movement',
      sortValue: (e) => e.kind,
      cell: (e) => EARTHWORKS_LABELS[e.kind],
    },
    {
      id: 'vol',
      header: 'Volume',
      align: 'end',
      sortValue: (e) => e.volumeM3,
      cell: (e) => m3(e.volumeM3),
    },
    { id: 'material', header: 'Material', cell: (e) => e.material ?? '—' },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: <span className="u-visually-hidden">Actions</span>,
            cell: (e: EarthworksEntry) => (
              <Button
                variant="tertiary"
                aria-label={`Remove ${EARTHWORKS_LABELS[e.kind]} ${e.zone} ${e.recordedOn}`}
                onClick={() => onDelete(e)}
              >
                Remove
              </Button>
            ),
          } satisfies DataTableColumn<EarthworksEntry>,
        ]
      : []),
  ];
  const vol = (v: number) => v.toLocaleString('en-AU');
  const balanceColumns: DataTableColumn<(typeof zones)[number]>[] = [
    {
      id: 'zone',
      header: 'Zone',
      rowHeader: true,
      cell: (z) => (
        <>
          {z.zone}
          {z.imported > 0 || z.exported > 0 ? (
            <div className="u-muted">
              {[
                z.imported > 0 ? `In ${vol(z.imported)}` : '',
                z.exported > 0 ? `Out ${vol(z.exported)}` : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          ) : null}
        </>
      ),
    },
    { id: 'cut', header: 'Cut', align: 'end', cell: (z) => vol(z.cut) },
    { id: 'fill', header: 'Fill', align: 'end', cell: (z) => vol(z.fill) },
    {
      id: 'balance',
      header: 'Balance',
      align: 'end',
      cell: (z) => (
        <StatusPill tone={z.balance < 0 ? 'warning' : 'neutral'}>
          {z.balance > 0 ? '+' : ''}
          {vol(z.balance)}
        </StatusPill>
      ),
    },
  ];
  return (
    <>
      <ErrorAlert error={list.error ?? summary.error} title="We couldn't load earthworks" />
      {list.isPending || summary.isPending ? (
        <SkeletonRows label="Loading earthworks…" />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState
          icon={GeotechIcon}
          title="No earthworks recorded"
          description="Record cut, fill, imported and exported volumes by zone to see the material balance."
        />
      ) : (
        <>
          <Card
            title="Balance by zone"
            actions={
              <span className="u-muted">
                All volumes in m³. Balance is cut + import − fill − export; negative means short of
                material.
              </span>
            }
          >
            <DataTable
              caption="Earthworks balance by zone"
              columns={balanceColumns}
              rows={zones}
              getRowId={(z) => z.zone}
            />
            {summary.data ? (
              <p className="u-muted">
                Project total: cut {m3(summary.data.total.cut)}, fill {m3(summary.data.total.fill)},
                balance {m3(summary.data.total.balance)}.
              </p>
            ) : null}
          </Card>
          <DataTable
            caption="Earthworks entries"
            columns={columns}
            rows={list.data ?? []}
            getRowId={(e) => e.id}
          />
        </>
      )}
    </>
  );
}

function InvestigationDialog({
  pending,
  error,
  onClose,
  onSave,
}: {
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (i: InvestigationInput) => void;
}) {
  const [kind, setKind] = useState<InvestigationKind>('borehole');
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [depth, setDepth] = useState('');
  const [water, setWater] = useState('');
  const [on, setOn] = useState('');
  const [summary, setSummary] = useState('');
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add investigation"
      description="Record where and how deep you looked and what was found. Attach the log or consultant report from the investigation's page once it's saved."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim() || pending}
            onClick={() =>
              onSave({
                kind,
                title: title.trim(),
                location: location.trim() || null,
                depthM: optNum(depth),
                groundwaterDepthM: optNum(water),
                investigatedOn: on || null,
                summary: summary.trim() || null,
              })
            }
          >
            {pending ? 'Saving…' : 'Add investigation'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Select
          label="Type"
          value={kind}
          options={INVESTIGATION_KINDS.map((v) => ({ value: v, label: INVESTIGATION_LABELS[v] }))}
          onChange={(e) => setKind(e.target.value as InvestigationKind)}
        />
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <TextField
          label="Location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
        <TextField
          label="Depth (m)"
          type="number"
          inputMode="decimal"
          min={0}
          value={depth}
          onChange={(e) => setDepth(e.target.value)}
        />
        <TextField
          label="Groundwater depth (m)"
          type="number"
          inputMode="decimal"
          min={0}
          value={water}
          onChange={(e) => setWater(e.target.value)}
        />
        <TextField label="Date" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
        <Textarea label="Summary" value={summary} onChange={(e) => setSummary(e.target.value)} />
        <ErrorAlert error={error} title="We couldn't save the investigation" />
      </div>
    </Dialog>
  );
}

function TestDialog({
  pending,
  error,
  onClose,
  onSave,
}: {
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (i: TestInput) => void;
}) {
  const [kind, setKind] = useState<TestKind>('cbr');
  const [sample, setSample] = useState('');
  const [zone, setZone] = useState('');
  const [value, setValue] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [on, setOn] = useState(todayIso());
  const v = optNum(value);
  const lo = optNum(min);
  const hi = optNum(max);
  const backwards = lo !== null && hi !== null && lo > hi;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add test result"
      description="Type the spec limits from the specification so Archova can show whether the result is inside them. Leave both blank to record the result without a judgement."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={v === null || !on || backwards || pending}
            onClick={() =>
              onSave({
                kind,
                value: v!,
                unit: TEST_UNITS[kind] || null,
                sampleRef: sample.trim() || null,
                zone: zone.trim() || null,
                specMin: lo,
                specMax: hi,
                testedOn: on,
              })
            }
          >
            {pending ? 'Saving…' : 'Add test result'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Select
          label="Test"
          value={kind}
          options={TEST_KINDS.map((t) => ({ value: t, label: TEST_LABELS[t] }))}
          onChange={(e) => setKind(e.target.value as TestKind)}
        />
        <TextField
          label="Sample reference"
          value={sample}
          onChange={(e) => setSample(e.target.value)}
        />
        <TextField label="Zone" value={zone} onChange={(e) => setZone(e.target.value)} />
        <TextField
          label={`Result${TEST_UNITS[kind] ? ` (${TEST_UNITS[kind]})` : ''}`}
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <TextField
          label="Minimum allowed"
          type="number"
          inputMode="decimal"
          value={min}
          onChange={(e) => setMin(e.target.value)}
        />
        <TextField
          label="Maximum allowed"
          type="number"
          inputMode="decimal"
          value={max}
          error={backwards ? 'The minimum is above the maximum.' : undefined}
          onChange={(e) => setMax(e.target.value)}
        />
        <TextField
          label="Tested on"
          type="date"
          value={on}
          onChange={(e) => setOn(e.target.value)}
        />
        <ErrorAlert error={error} title="We couldn't save the test result" />
      </div>
    </Dialog>
  );
}

function EarthworksDialog({
  pending,
  error,
  onClose,
  onSave,
}: {
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (i: EarthworksInput) => void;
}) {
  const [zone, setZone] = useState('');
  const [kind, setKind] = useState<EarthworksKind>('cut');
  const [volume, setVolume] = useState('');
  const [material, setMaterial] = useState('');
  const [on, setOn] = useState(todayIso());
  const v = optNum(volume);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add volume"
      description="Record a cut, fill, import or export volume for a zone, in cubic metres."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!zone.trim() || v === null || v <= 0 || !on || pending}
            onClick={() =>
              onSave({
                zone: zone.trim(),
                kind,
                volumeM3: v!,
                material: material.trim() || null,
                recordedOn: on,
              })
            }
          >
            {pending ? 'Saving…' : 'Add volume'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField label="Zone" value={zone} onChange={(e) => setZone(e.target.value)} />
        <Select
          label="Movement"
          value={kind}
          options={EARTHWORKS_KINDS.map((k) => ({ value: k, label: EARTHWORKS_LABELS[k] }))}
          onChange={(e) => setKind(e.target.value as EarthworksKind)}
        />
        <TextField
          label="Volume (m³)"
          type="number"
          inputMode="decimal"
          min={0}
          value={volume}
          error={v !== null && v <= 0 ? 'Enter a volume above zero.' : undefined}
          onChange={(e) => setVolume(e.target.value)}
        />
        <TextField
          label="Material"
          value={material}
          onChange={(e) => setMaterial(e.target.value)}
        />
        <TextField label="Date" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
        <ErrorAlert error={error} title="We couldn't save the volume" />
      </div>
    </Dialog>
  );
}
