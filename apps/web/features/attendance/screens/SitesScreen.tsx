'use client';

import Link from 'next/link';
import { useState } from 'react';
import { atLeast } from '@archova/domain/permissions';
import { webRoutes } from '@archova/routes';
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
  Switch,
  TextField,
  buttonClassName,
  type DataTableColumn,
} from '@archova/ui';
import { AttendanceIcon, ChevronLeft, Plus } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { useProjectPermissions } from '@/features/projects';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { GateQr, gateQrSvg } from '../components/GateQr';
import { useSiteMutations, useSites } from '../hooks/useAttendance';
import {
  CHECK_MODE_LABELS,
  type AttendanceSite,
  type Gate,
  type GateCheckMode,
  type GateWithCode,
  type SiteInput,
} from '../lib/types';

type Editing =
  | { kind: 'site'; site: AttendanceSite | null }
  | { kind: 'gate'; site: AttendanceSite; gate: Gate | null };

/** `19:00` shown as `7:00 pm`. */
function dayEnd(hhmm: string): string {
  const [h = '0', m = '00'] = hhmm.split(':');
  const hour = Number(h);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${m} ${hour < 12 ? 'am' : 'pm'}`;
}

/** Sites and gates (ATT-AC1): add a site, add a gate and print its QR poster, or reissue a code. */
export function SitesScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const permissions = useProjectPermissions(org.orgId, project.projectId);
  // UI gating only; the API enforces `workforce.attendance.manage` (site managers, tool level admin).
  const canManage =
    previewDataOnly ||
    (permissions.data
      ? permissions.data.orgRole === 'owner' ||
        permissions.data.orgRole === 'admin' ||
        atLeast(permissions.data.toolLevels.workforce, 'admin')
      : false);
  const sites = useSites();
  const m = useSiteMutations();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [reissuing, setReissuing] = useState<Gate | null>(null);
  const [shown, setShown] = useState<GateWithCode | null>(null);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'attendance', id: 'sites' },
  });

  const gateColumns = (site: AttendanceSite): DataTableColumn<Gate>[] => [
    { id: 'name', header: 'Gate', rowHeader: true, sortValue: (g) => g.name, cell: (g) => g.name },
    {
      id: 'status',
      header: 'Status',
      cell: (g) =>
        g.active ? (
          <StatusPill tone="success">In use</StatusPill>
        ) : (
          <StatusPill tone="neutral">Closed</StatusPill>
        ),
    },
    {
      id: 'code',
      header: 'Code',
      align: 'end',
      sortValue: (g) => g.qrVersion,
      cell: (g) => `Version ${g.qrVersion}`,
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: <span className="u-visually-hidden">Actions</span>,
            cell: (g: Gate) => (
              <span className="row-actions">
                <Button
                  variant="tertiary"
                  aria-label={`Rename ${g.name}`}
                  onClick={() => setEditing({ kind: 'gate', site, gate: g })}
                >
                  Rename
                </Button>
                <Button
                  variant="tertiary"
                  aria-label={`New code for ${g.name}`}
                  onClick={() => setReissuing(g)}
                >
                  New code
                </Button>
                <Button
                  variant="tertiary"
                  aria-label={`${g.active ? 'Close' : 'Reopen'} ${g.name}`}
                  disabled={m.updateGate.isPending}
                  onClick={() => m.updateGate.mutate({ gate: g, patch: { active: !g.active } })}
                >
                  {g.active ? 'Close' : 'Reopen'}
                </Button>
              </span>
            ),
          } satisfies DataTableColumn<Gate>,
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        eyebrow="Workforce"
        title="Sites and gates"
        description="Each gate has a QR code on a poster. People scan it to sign in and out."
        actions={
          <>
            <Link
              className={buttonClassName('secondary')}
              href={webRoutes.attendance(org.orgSlug, project.projectId)}
            >
              <ChevronLeft size={16} aria-hidden="true" /> Attendance
            </Link>
            {canManage ? (
              <Button onClick={() => setEditing({ kind: 'site', site: null })}>
                <Plus size={16} aria-hidden="true" /> Add site
              </Button>
            ) : null}
          </>
        }
      />
      {previewDataOnly ? <PreviewDataNotice tool="Sites and gates" /> : null}
      <ErrorAlert
        error={sites.error ?? m.updateGate.error}
        title="Something went wrong with sites"
      />
      {sites.isPending ? (
        <SkeletonRows label="Loading sites…" />
      ) : (sites.data ?? []).length === 0 ? (
        <EmptyState
          icon={AttendanceIcon}
          title="No sites yet"
          description={
            canManage
              ? 'Add a site, then a gate to print its QR code.'
              : 'A site manager adds sites and gates.'
          }
        />
      ) : (
        (sites.data ?? []).map((site) => (
          <Card
            key={site.id}
            title={site.name}
            actions={
              canManage ? (
                <Button variant="secondary" onClick={() => setEditing({ kind: 'site', site })}>
                  Edit<span className="u-visually-hidden"> {site.name}</span>
                </Button>
              ) : undefined
            }
          >
            <p className="u-caption u-m-0">
              {site.active ? 'In use' : 'Closed'} · Open sign-ins close at{' '}
              {dayEnd(site.dayEndLocal)} · {CHECK_MODE_LABELS[site.gateCheckMode]} ·{' '}
              {site.boundary
                ? `Boundary ${site.boundary.radiusM} m around ${site.boundary.lat.toFixed(5)}, ${site.boundary.lng.toFixed(5)}`
                : 'Boundary from the project location'}
            </p>
            <DataTable
              caption={`Gates at ${site.name}`}
              columns={gateColumns(site)}
              rows={site.gates}
              getRowId={(g) => g.id}
              empty={
                <EmptyState
                  icon={AttendanceIcon}
                  title="No gates"
                  description="Add a gate to get a QR code people can scan."
                />
              }
            />
            {canManage ? (
              <p className="u-m-0">
                <Button
                  variant="secondary"
                  onClick={() => setEditing({ kind: 'gate', site, gate: null })}
                >
                  <Plus size={16} aria-hidden="true" /> Add gate
                  <span className="u-visually-hidden"> to {site.name}</span>
                </Button>
              </p>
            ) : null}
          </Card>
        ))
      )}

      {editing?.kind === 'site' ? (
        <SiteDialog
          key={editing.site?.id ?? 'new'}
          site={editing.site}
          pending={m.createSite.isPending || m.updateSite.isPending}
          error={m.createSite.error ?? m.updateSite.error}
          onClose={() => setEditing(null)}
          onSave={(input) =>
            editing.site
              ? m.updateSite.mutate(
                  { site: editing.site, patch: input },
                  { onSuccess: () => setEditing(null) },
                )
              : m.createSite.mutate(input, { onSuccess: () => setEditing(null) })
          }
        />
      ) : null}
      {editing?.kind === 'gate' ? (
        <GateDialog
          key={editing.gate?.id ?? 'new'}
          gate={editing.gate}
          siteName={editing.site.name}
          pending={m.createGate.isPending || m.updateGate.isPending}
          error={m.createGate.error ?? m.updateGate.error}
          onClose={() => setEditing(null)}
          onSave={(name) => {
            const done = () => setEditing(null);
            if (editing.gate) {
              m.updateGate.mutate({ gate: editing.gate, patch: { name } }, { onSuccess: done });
            } else {
              m.createGate.mutate(
                { siteId: editing.site.id, name },
                {
                  onSuccess: (r) => {
                    done();
                    setShown(r);
                  },
                },
              );
            }
          }}
        />
      ) : null}
      <Dialog
        open={reissuing !== null}
        onClose={() => setReissuing(null)}
        title={reissuing ? `New code for ${reissuing.name}` : 'New code'}
        description="The old code stops working straight away. Posters already printed with it must be replaced."
        footer={
          <>
            <Button variant="secondary" onClick={() => setReissuing(null)}>
              Cancel
            </Button>
            <Button
              disabled={m.reissueGate.isPending}
              onClick={() =>
                reissuing &&
                m.reissueGate.mutate(reissuing, {
                  onSuccess: (r) => {
                    setReissuing(null);
                    setShown(r);
                  },
                })
              }
            >
              {m.reissueGate.isPending ? 'Issuing…' : 'Issue new code'}
            </Button>
          </>
        }
      >
        <ErrorAlert error={m.reissueGate.error} title="We couldn't issue a new code" />
      </Dialog>
      <Dialog
        open={shown !== null}
        onClose={() => setShown(null)}
        title={shown ? `QR code for ${shown.gate.name}` : 'QR code'}
        footer={
          <>
            {shown ? (
              <a
                className={buttonClassName('secondary')}
                href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(gateQrSvg(shown.code))}`}
                download={`${shown.gate.name.replace(/[^\w-]+/g, '-')}-qr.svg`}
              >
                Download QR
              </a>
            ) : null}
            <Button onClick={() => setShown(null)}>Done</Button>
          </>
        }
      >
        {shown ? (
          <div className="stack">
            <Alert tone="warning" title="Print or download it now">
              This code is shown once. If you lose it, issue a new code, which stops the old one
              working.
            </Alert>
            <GateQr code={shown.code} label={`QR code for ${shown.gate.name}`} />
            <p className="u-caption u-m-0">
              Can’t scan? The code is <span className="u-mono">{shown.code}</span>
            </p>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}

function SiteDialog({
  site,
  pending,
  error,
  onClose,
  onSave,
}: {
  site: AttendanceSite | null;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (input: SiteInput) => void;
}) {
  const [name, setName] = useState(site?.name ?? '');
  const [dayEndLocal, setDayEnd] = useState(site?.dayEndLocal ?? '19:00');
  const [mode, setMode] = useState<GateCheckMode>(site?.gateCheckMode ?? 'block');
  const [custom, setCustom] = useState(site?.boundary !== null);
  const [lat, setLat] = useState(site?.boundary ? String(site.boundary.lat) : '');
  const [lng, setLng] = useState(site?.boundary ? String(site.boundary.lng) : '');
  const [radius, setRadius] = useState(site?.boundary ? String(site.boundary.radiusM) : '100');
  const latN = Number(lat);
  const lngN = Number(lng);
  const radiusN = Number(radius);
  const latOk = lat.trim() !== '' && latN >= -90 && latN <= 90;
  const lngOk = lng.trim() !== '' && lngN >= -180 && lngN <= 180;
  const radiusOk = Number.isInteger(radiusN) && radiusN >= 10 && radiusN <= 10000;
  const boundaryOk = !custom || (latOk && lngOk && radiusOk);
  const valid =
    name.trim().length > 0 && /^([01]\d|2[0-3]):[0-5]\d$/.test(dayEndLocal) && boundaryOk;
  return (
    <Dialog
      open
      onClose={onClose}
      title={site ? `Edit ${site.name}` : 'Add site'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid || pending}
            onClick={() =>
              onSave({
                name: name.trim(),
                dayEndLocal,
                gateCheckMode: mode,
                boundary: custom ? { lat: latN, lng: lngN, radiusM: radiusN } : null,
              })
            }
          >
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField label="Site name" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField
          label="Open sign-ins close at"
          type="time"
          value={dayEndLocal}
          hint="Site time. People still signed in then are closed out, and their hours are marked as approximate."
          onChange={(e) => setDayEnd(e.target.value)}
        />
        <Select
          label="When a worker fails the induction check"
          value={mode}
          options={(Object.keys(CHECK_MODE_LABELS) as GateCheckMode[]).map((v) => ({
            value: v,
            label: CHECK_MODE_LABELS[v],
          }))}
          onChange={(e) => setMode(e.target.value as GateCheckMode)}
        />
        <Switch
          label="Use a custom boundary for this site"
          checked={custom}
          onCheckedChange={setCustom}
        />
        {custom ? (
          <>
            <p className="u-caption u-m-0">
              A circle for geofence sign-in. Leave it off to use the project’s site location. Only
              builder staff can sign in by geofence.
            </p>
            <TextField
              label="Latitude"
              inputMode="decimal"
              value={lat}
              placeholder="-33.86882"
              error={lat !== '' && !latOk ? 'Enter a latitude between -90 and 90.' : undefined}
              onChange={(e) => setLat(e.target.value)}
            />
            <TextField
              label="Longitude"
              inputMode="decimal"
              value={lng}
              placeholder="151.20929"
              error={lng !== '' && !lngOk ? 'Enter a longitude between -180 and 180.' : undefined}
              onChange={(e) => setLng(e.target.value)}
            />
            <TextField
              label="Radius (metres)"
              inputMode="numeric"
              value={radius}
              hint="Between 10 m and 10 km."
              error={!radiusOk ? 'Enter a whole number from 10 to 10000.' : undefined}
              onChange={(e) => setRadius(e.target.value)}
            />
          </>
        ) : null}
        <ErrorAlert error={error} title="We couldn't save the site" />
      </div>
    </Dialog>
  );
}

function GateDialog({
  gate,
  siteName,
  pending,
  error,
  onClose,
  onSave,
}: {
  gate: Gate | null;
  siteName: string;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(gate?.name ?? '');
  return (
    <Dialog
      open
      onClose={onClose}
      title={gate ? `Rename ${gate.name}` : `Add gate to ${siteName}`}
      description={gate ? undefined : 'You’ll get the gate’s QR code to print once it’s added.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!name.trim() || pending} onClick={() => onSave(name.trim())}>
            {pending ? 'Saving…' : gate ? 'Save' : 'Add gate'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField label="Gate name" value={name} onChange={(e) => setName(e.target.value)} />
        <ErrorAlert error={error} title="We couldn't save the gate" />
      </div>
    </Dialog>
  );
}
