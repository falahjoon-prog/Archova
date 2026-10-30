'use client';

import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { queryKeys } from '@archova/query';
import { webRoutes } from '@archova/routes';
import {
  Alert,
  Button,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatusPill,
  Tabs,
  TextField,
} from '@archova/ui';
import { InductionsIcon } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { CurrencyPanel } from '../components/CurrencyPanel';
import { NovaDraftPanel } from '../components/NovaDraftPanel';
import { LinksPanel } from '../components/LinksPanel';
import { PublishDialog } from '../components/PublishDialog';
import { QuizEditor } from '../components/QuizEditor';
import { SectionEditor } from '../components/SectionEditor';
import { useInduction, useInductionMutations, useInductionRefresh } from '../hooks/useBuilder';
import { contentProblems, isApproved, newSection, sameContent } from '../lib/content';
import { applyDraft, applyRefresh, type AiSuggestion, type ParsedRefresh } from '../lib/refresh';
import { INDUCTION_STATUS, type Induction, type InductionContent } from '../lib/types';

/** Edit one induction's draft, approve its sections and publish a version (IND-AC1 to AC6). */
export function InductionEditorScreen({ inductionId }: { inductionId: string }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'induction', id: inductionId },
  });
  const induction = useInduction(inductionId);
  const back = (
    <Link className="link" href={webRoutes.inductions(org.orgSlug, project.projectId)}>
      All inductions
    </Link>
  );
  if (induction.isPending) return <SkeletonRows label="Loading induction…" />;
  if (!induction.data)
    return (
      <div className="stack-lg">
        <ErrorAlert error={induction.error} title="We couldn't load this induction" />
        {back}
      </div>
    );
  return <Editor induction={induction.data} back={back} />;
}

function Editor({ induction, back }: { induction: Induction; back: React.ReactNode }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const directory = useProjectDirectory();
  const m = useInductionMutations(induction);
  const [content, setContent] = useState<InductionContent>(() => structuredClone(induction.draft));
  const qc = useQueryClient();
  const nova = useInductionRefresh();
  // The redraft waiting to be taken in, and the one taken in but not yet saved (saved with `aiSuggestionId`).
  const [redraft, setRedraft] = useState<AiSuggestion | null>(null);
  const [novaDraft, setNovaDraft] = useState<AiSuggestion | null>(null);
  const [taken, setTaken] = useState<string | null>(null);
  const [tab, setTab] = useState('content');
  const [publishing, setPublishing] = useState(false);
  const [settings, setSettings] = useState({
    title: induction.title,
    validityMonths: String(induction.validityMonths),
  });
  const archived = induction.status === 'archived';
  const dirty = !sameContent(content, induction.draft);
  const local = contentProblems(content);
  const months = Number(settings.validityMonths);
  const settingsValid =
    !!settings.title.trim() && Number.isInteger(months) && months >= 1 && months <= 60;
  const settingsDirty =
    settings.title.trim() !== induction.title || months !== induction.validityMonths;
  const nextNumber = (induction.versions[0]?.number ?? 0) + 1;
  const busy = m.saveDraft.isPending || m.approve.isPending || m.publish.isPending;
  const canPublish = !archived && !dirty && induction.problems.length === 0 && !busy;
  const status = INDUCTION_STATUS[induction.status];

  const setSection = (i: number, s: InductionContent['sections'][number]) =>
    setContent({ ...content, sections: content.sections.map((x, n) => (n === i ? s : x)) });
  const move = (i: number, delta: -1 | 1) => {
    const sections = [...content.sections];
    const [s] = sections.splice(i, 1);
    if (s) sections.splice(i + delta, 0, s);
    setContent({ ...content, sections });
  };

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow={back}
        title={induction.title}
        description={`Valid for ${induction.validityMonths} months once completed.`}
        actions={
          <>
            <StatusPill tone={status.tone}>{status.label}</StatusPill>
            <Button
              variant="secondary"
              disabled={archived || !dirty || local.length > 0 || busy}
              onClick={() =>
                m.saveDraft.mutate(
                  { content, ...(taken ? { aiSuggestionId: taken } : {}) },
                  {
                    // Take the server's copy (ids, key order) unless more was typed while it saved.
                    onSuccess: (next) => {
                      setContent((now) =>
                        sameContent(now, content) ? structuredClone(next.draft) : now,
                      );
                      if (taken) {
                        nova.decide.mutate({ suggestionId: taken, decision: 'accepted' });
                        setTaken(null);
                        setRedraft(null);
                        setNovaDraft(null);
                        // The check now follows the refresh the draft rests on.
                        void qc.invalidateQueries({
                          queryKey: queryKeys.tool(org.orgId, project.projectId, 'inductions'),
                        });
                      }
                    },
                  },
                )
              }
            >
              Save draft
            </Button>
            <Button disabled={!canPublish} onClick={() => setPublishing(true)}>
              Publish version {nextNumber}
            </Button>
          </>
        }
      />
      {previewDataOnly ? <PreviewDataNotice tool="Inductions" /> : null}
      {archived ? (
        <Alert tone="info">This induction is archived and can't be changed.</Alert>
      ) : null}
      <ErrorAlert error={m.saveDraft.error} title="We couldn't save the draft" />
      <ErrorAlert error={m.approve.error} title="We couldn't approve that section" />
      {dirty ? (
        <Alert tone="warning" title="Unsaved changes">
          {local.length
            ? local.join(' ')
            : 'Save the draft to approve sections or publish. Approving a section covers the text as saved.'}
        </Alert>
      ) : induction.problems.length && !archived ? (
        <Alert tone="info" title="Before you can publish">
          <ul className="plain-list">
            {induction.problems.map((p) => (
              <li key={`${p.path}:${p.message}`}>{p.message}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {induction.draftAiSuggestionId && !archived ? (
        <CurrencyPanel
          suggestionId={induction.draftAiSuggestionId}
          disabled={busy}
          pending={redraft}
          onPending={setRedraft}
          onTake={(r: ParsedRefresh) => {
            setContent(applyRefresh(content, r));
            setTaken(r.suggestionId);
            setRedraft(null);
            setTab('content');
          }}
        />
      ) : null}
      {!induction.draftAiSuggestionId && !taken && !archived ? (
        <NovaDraftPanel
          hasContent={content.sections.length > 0 || content.quiz.length > 0}
          disabled={busy}
          pending={novaDraft}
          onPending={setNovaDraft}
          onTake={(r: ParsedRefresh) => {
            setContent(applyDraft(content, r));
            setTaken(r.suggestionId);
            setNovaDraft(null);
            setTab('content');
          }}
        />
      ) : null}
      <Tabs
        label="Induction"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { id: 'content', label: 'Sections', count: content.sections.length },
          { id: 'quiz', label: 'Quiz', count: content.quiz.length },
          { id: 'versions', label: 'Versions', count: induction.versions.length },
          { id: 'links', label: 'Links' },
          { id: 'settings', label: 'Settings' },
        ]}
      >
        {tab === 'content' ? (
          <div className="stack-lg">
            {content.sections.length === 0 ? (
              <EmptyState
                icon={InductionsIcon}
                title="No sections yet"
                description="Add the topics workers must read, such as emergencies, PPE and site rules."
              />
            ) : null}
            {content.sections.map((s, i) => (
              <SectionEditor
                key={i}
                index={i}
                section={s}
                count={content.sections.length}
                approved={!dirty && isApproved(induction, i)}
                canApprove={!dirty && !archived}
                busy={busy}
                onChange={(next) => setSection(i, next)}
                onMove={(d) => move(i, d)}
                onRemove={() =>
                  setContent({
                    ...content,
                    sections: content.sections.filter((_, n) => n !== i),
                  })
                }
                onApprove={() => m.approve.mutate(i)}
              />
            ))}
            <div>
              <Button
                variant="secondary"
                disabled={archived || content.sections.length >= 30}
                onClick={() =>
                  setContent({ ...content, sections: [...content.sections, newSection()] })
                }
              >
                Add section
              </Button>
            </div>
          </div>
        ) : null}
        {tab === 'quiz' ? <QuizEditor content={content} onChange={setContent} /> : null}
        {tab === 'versions' ? (
          induction.versions.length === 0 ? (
            <EmptyState
              icon={InductionsIcon}
              title="Nothing published yet"
              description="Approve every section, then publish. Workers can only complete a published version."
            />
          ) : (
            <ul className="plain-list">
              {induction.versions.map((v) => (
                <li key={v.id} className="plain-list__item">
                  <strong>
                    Version {v.number}
                    {induction.requiredVersion?.number === v.number ? ' · required today' : ''}
                  </strong>
                  <span className="u-caption">
                    Published {formatInstant(v.publishedAt, project.timezone)}
                    {v.publishedBy ? ` by ${directory.personName(v.publishedBy)}` : ''} ·{' '}
                    {v.redo === 'all'
                      ? `everyone redoes it${v.graceDays ? `, ${v.graceDays} days grace` : ''}`
                      : 'minor change, no redo'}
                  </span>
                  {v.changeNote ? <span>{v.changeNote}</span> : null}
                </li>
              ))}
            </ul>
          )
        ) : null}
        {tab === 'links' ? <LinksPanel induction={induction} /> : null}
        {tab === 'settings' ? (
          <div className="stack">
            <TextField
              label="Title"
              value={settings.title}
              disabled={archived}
              onChange={(e) => setSettings({ ...settings, title: e.target.value })}
            />
            <TextField
              label="Valid for (months)"
              hint="How long a completed induction stays current."
              type="number"
              min={1}
              max={60}
              disabled={archived}
              value={settings.validityMonths}
              error={
                Number.isInteger(months) && months >= 1 && months <= 60
                  ? undefined
                  : 'Enter a whole number from 1 to 60.'
              }
              onChange={(e) => setSettings({ ...settings, validityMonths: e.target.value })}
            />
            <ErrorAlert error={m.update.error} title="We couldn't save the settings" />
            <div className="row-actions">
              <Button
                disabled={archived || !settingsDirty || !settingsValid || m.update.isPending}
                onClick={() =>
                  m.update.mutate({ title: settings.title.trim(), validityMonths: months })
                }
              >
                Save settings
              </Button>
              <Button
                variant="danger"
                disabled={archived || m.update.isPending}
                onClick={() => m.update.mutate({ status: 'archived' })}
              >
                Archive induction
              </Button>
            </div>
          </div>
        ) : null}
      </Tabs>
      <PublishDialog
        open={publishing}
        nextNumber={nextNumber}
        isFirst={induction.versions.length === 0}
        pending={m.publish.isPending}
        error={m.publish.error}
        onClose={() => setPublishing(false)}
        onPublish={(input) => m.publish.mutate(input, { onSuccess: () => setPublishing(false) })}
      />
    </div>
  );
}
