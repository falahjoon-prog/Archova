'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { webRoutes } from '@archova/routes';
import {
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  TextField,
  Textarea,
  buttonClassName,
} from '@archova/ui';
import { CoordinationIcon } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { CoordinationIssuePriority } from '../data/api';
import {
  useBimModels,
  useCoordinationMutations,
  useModelFileLoader,
} from '../hooks/useCoordination';
import { clashTitle, detectClashes, type Clash, type ClashResult } from '../lib/clash';
import { PRIORITY_LABEL } from '../lib/issues';
import { createIfcApi, friendlyType, parseIfc, type IfcElement } from '../viewer/ifc';
import { elementKey, type ElementRef, type Flag, type ViewerModel } from '../viewer/ModelViewer';

// three.js and the IFC reader are big: they load only when someone opens this screen.
const ModelViewer = dynamic(() => import('../viewer/ModelViewer').then((m) => m.ModelViewer), {
  ssr: false,
  loading: () => <SkeletonRows rows={4} label="Loading the viewer…" />,
});

const TOLERANCES = [
  { value: '0.005', label: '5 mm and deeper' },
  { value: '0.02', label: '20 mm and deeper' },
  { value: '0.05', label: '50 mm and deeper' },
];
const PRIORITIES = Object.keys(PRIORITY_LABEL) as CoordinationIssuePriority[];

type Draft = { title: string; modelId: string; guids: string[]; location: string };

const mm = (metres: number) => `${Math.round(metres * 1000)} mm`;

/** Opens project models in 3D, picks elements to pin an issue to, and checks two or more models for clashes. */
export function ModelViewerScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const models = useBimModels();
  const download = useModelFileLoader();
  const m = useCoordinationMutations();

  const withFiles = (models.data ?? []).filter((x) => x.status === 'current' && x.fileId);
  const [chosen, setChosen] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<ViewerModel[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);

  const [picked, setPicked] = useState<ElementRef | null>(null);
  const [tolerance, setTolerance] = useState('0.005');
  const [result, setResult] = useState<ClashResult | null>(null);
  const [active, setActive] = useState<Clash | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<CoordinationIssuePriority>('medium');
  const [raised, setRaised] = useState<{ id: string; number: number } | null>(null);

  const nameOf = (id: string) => (models.data ?? []).find((x) => x.id === id)?.name ?? 'Model';
  const byRef = useMemo(() => {
    const map = new Map<string, IfcElement>();
    for (const lm of loaded)
      for (const el of lm.elements)
        map.set(elementKey({ modelId: lm.modelId, expressId: el.expressId }), el);
    return map;
  }, [loaded]);

  const flags = useMemo(() => {
    const f = new Map<string, Flag>();
    if (picked) f.set(elementKey(picked), 'selected');
    if (active) {
      f.set(elementKey(active.a), 'clash');
      f.set(elementKey(active.b), 'clash');
    }
    return f;
  }, [picked, active]);

  const pickedEl = picked ? byRef.get(elementKey(picked)) : undefined;

  async function load() {
    setLoadError(null);
    setResult(null);
    setActive(null);
    setPicked(null);
    setRaised(null);
    try {
      const api = await createIfcApi('/wasm/');
      const next: ViewerModel[] = [];
      for (const [i, id] of chosen.entries()) {
        const model = withFiles.find((x) => x.id === id);
        if (!model?.fileId) continue;
        setProgress(`Reading ${model.name} (${i + 1} of ${chosen.length})…`);
        const bytes = await download(model.fileId);
        // Let the page paint the message before the parser takes the thread.
        await new Promise((r) => setTimeout(r, 0));
        next.push({ modelId: id, elements: parseIfc(api, bytes) });
      }
      setLoaded(next);
    } catch (e) {
      setLoadError(e);
    } finally {
      setProgress(null);
    }
  }

  function check() {
    setActive(null);
    setResult(
      detectClashes(
        loaded.flatMap((lm) => lm.elements.map((e) => ({ ...e, modelId: lm.modelId }))),
        { tolerance: Number(tolerance) },
      ),
    );
  }

  function openDraft(next: Draft) {
    m.raise.reset();
    setDescription('');
    setPriority('medium');
    setDraft(next);
  }

  const raiseFromElement = () => {
    if (!picked || !pickedEl) return;
    openDraft({
      title: `${pickedEl.name || friendlyType(pickedEl.ifcType)} (${nameOf(picked.modelId)})`.slice(
        0,
        200,
      ),
      modelId: picked.modelId,
      guids: pickedEl.guid ? [pickedEl.guid] : [],
      location: '',
    });
  };
  const raiseFromClash = (c: Clash) =>
    openDraft({
      title: clashTitle(c, nameOf),
      modelId: c.a.modelId,
      guids: [c.a.guid, c.b.guid].filter(Boolean),
      location: '',
    });

  const back = webRoutes.coordination(org.orgSlug, project.projectId);

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="Coordination"
        title="Model viewer"
        description="Open the registered IFC models in 3D, pin an issue to an element, and check models against each other for clashes."
        actions={
          <Link className={buttonClassName('secondary')} href={back}>
            Back to issues
          </Link>
        }
      />
      <ErrorAlert error={models.error} title="We couldn't load the models" />
      {models.isPending ? (
        <SkeletonRows label="Loading models…" />
      ) : withFiles.length === 0 ? (
        <EmptyState
          icon={CoordinationIcon}
          title="No model files yet"
          description={
            (models.data ?? []).length > 0
              ? 'None of the registered models has an IFC file attached. Register a model again with its .ifc file under Models on the issues page.'
              : 'Open the issues page, choose Register a model under Models and attach an .ifc file. It will then appear here to open in 3D.'
          }
          action={
            <Link className={buttonClassName('primary')} href={back}>
              Go to models
            </Link>
          }
        />
      ) : (
        <>
          <section aria-labelledby="pick-title" className="stack">
            <h2 id="pick-title" className="u-m-0">
              Models to open
            </h2>
            {withFiles.map((x) => (
              <Checkbox
                key={x.id}
                label={x.name}
                hint={x.versionLabel || undefined}
                checked={chosen.includes(x.id)}
                onChange={(e) =>
                  setChosen((c) => (e.target.checked ? [...c, x.id] : c.filter((y) => y !== x.id)))
                }
              />
            ))}
            <div className="u-row">
              <Button disabled={chosen.length === 0 || progress !== null} onClick={load}>
                {progress ?? 'Open in 3D'}
              </Button>
            </div>
            <ErrorAlert error={loadError} title="We couldn't open the models" />
          </section>

          {loaded.length > 0 ? (
            <div className="bim-layout">
              <div className="bim-canvas">
                <ModelViewer
                  models={loaded}
                  flags={flags}
                  onPick={setPicked}
                  label="3D view of the opened models. Click an element to select it."
                />
              </div>
              <aside className="stack" aria-label="Selection and clashes">
                <section aria-labelledby="sel-title" className="stack">
                  <h2 id="sel-title" className="u-m-0">
                    Selected element
                  </h2>
                  {pickedEl && picked ? (
                    <>
                      <dl className="stack--flush u-m-0">
                        <dt>Name</dt>
                        <dd>{pickedEl.name || '—'}</dd>
                        <dt>Type</dt>
                        <dd>{friendlyType(pickedEl.ifcType)}</dd>
                        <dt>Model</dt>
                        <dd>{nameOf(picked.modelId)}</dd>
                        <dt>GlobalId</dt>
                        <dd className="u-mono">{pickedEl.guid || '—'}</dd>
                      </dl>
                      <Button onClick={raiseFromElement} disabled={!pickedEl.guid}>
                        Raise an issue
                      </Button>
                    </>
                  ) : (
                    <p className="u-m-0">Click an element in the view to see what it is.</p>
                  )}
                </section>

                <section aria-labelledby="clash-title" className="stack">
                  <h2 id="clash-title" className="u-m-0">
                    Clashes
                  </h2>
                  {loaded.length < 2 ? (
                    <p className="u-m-0">
                      Open two or more models to check them against each other.
                    </p>
                  ) : (
                    <>
                      <Select
                        label="Report overlaps"
                        value={tolerance}
                        options={TOLERANCES}
                        onChange={(e) => setTolerance(e.target.value)}
                      />
                      <Button variant="secondary" onClick={check}>
                        Check for clashes
                      </Button>
                    </>
                  )}
                  {result ? (
                    result.clashes.length === 0 ? (
                      <p className="u-m-0">No clashes found between these models.</p>
                    ) : (
                      <>
                        <p className="u-m-0">
                          {result.truncated
                            ? `Showing the ${result.clashes.length} largest overlaps.`
                            : `${result.clashes.length} possible ${result.clashes.length === 1 ? 'clash' : 'clashes'}.`}{' '}
                          These compare element bounding boxes, so confirm each one in the view.
                        </p>
                        <ul className="stack bim-clashes">
                          {result.clashes.map((c) => (
                            <li key={`${elementKey(c.a)}|${elementKey(c.b)}`}>
                              <button
                                type="button"
                                className="bim-clash"
                                aria-pressed={active === c}
                                onClick={() => setActive(active === c ? null : c)}
                              >
                                <strong>{clashTitle(c, nameOf)}</strong>
                                <span>Overlap {mm(c.depth)}</span>
                              </button>
                              {active === c ? (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => raiseFromClash(c)}
                                >
                                  Raise an issue
                                </Button>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </>
                    )
                  ) : null}
                </section>
                {raised ? (
                  <p className="u-m-0" role="status">
                    Issue {raised.number} raised.{' '}
                    <Link className="link" href={`${back}?issue=${raised.id}`}>
                      Open it
                    </Link>
                  </p>
                ) : null}
              </aside>
            </div>
          ) : null}
        </>
      )}

      <Dialog
        open={draft !== null}
        onClose={() => setDraft(null)}
        title="Raise a coordination issue"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              disabled={!draft?.title.trim() || m.raise.isPending}
              onClick={() =>
                draft &&
                m.raise.mutate(
                  {
                    title: draft.title.trim(),
                    priority,
                    modelId: draft.modelId,
                    elementGuids: draft.guids,
                    ...(description.trim() ? { description: description.trim() } : {}),
                  },
                  {
                    onSuccess: (d) => {
                      setRaised({ id: d.issue.id, number: d.issue.number });
                      setDraft(null);
                    },
                  },
                )
              }
            >
              {m.raise.isPending ? 'Raising…' : 'Raise issue'}
            </Button>
          </>
        }
      >
        <div className="stack">
          <TextField
            label="Title"
            value={draft?.title ?? ''}
            onChange={(e) => setDraft((d) => (d ? { ...d, title: e.target.value } : d))}
          />
          <Select
            label="Priority"
            value={priority}
            options={PRIORITIES.map((x) => ({ value: x, label: PRIORITY_LABEL[x] }))}
            onChange={(e) => setPriority(e.target.value as CoordinationIssuePriority)}
          />
          <Textarea
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <p className="u-m-0">
            Pinned to {draft?.guids.length ?? 0} element{draft?.guids.length === 1 ? '' : 's'}.
            Assign it and link the RFI from the issue.
          </p>
          <ErrorAlert error={m.raise.error} title="We couldn't raise the issue" />
        </div>
      </Dialog>
    </div>
  );
}
