// The induction builder's data source. `inductionBuilderSource` is the in-browser preview (synthetic, lost on
// reload) used in preview mode and tests; `data/api.ts` has the same interface against the workforce endpoints.
// The preview keeps the server's rules so the screens can't decide them: an approval belongs to the section as it
// was approved, and publishing needs every section approved.

import { delay, mockId, nowIso, problem, projectStores } from '@/shared/mocks/runtime';
import { emptyContent } from '../lib/content';
import type {
  Induction,
  InductionContent,
  InductionRegister,
  InductionVersionSummary,
  PublishInput,
  CreateInductionLinkInput,
  InductionLink,
  InductionLinkCreated,
} from '../lib/types';
import type { AiSuggestion, InductionCurrency } from '../lib/refresh';

export interface InductionBuilderSource {
  list(projectId: string): Promise<Induction[]>;
  get(projectId: string, inductionId: string): Promise<Induction>;
  create(projectId: string, input: { title: string; validityMonths: number }): Promise<Induction>;
  update(
    projectId: string,
    induction: Induction,
    patch: { title?: string; validityMonths?: number; status?: 'archived' },
  ): Promise<Induction>;
  /** `aiSuggestionId` records the Nova draft or refresh the content now rests on, so the currency check follows it. */
  saveDraft(
    projectId: string,
    induction: Induction,
    content: InductionContent,
    aiSuggestionId?: string,
  ): Promise<Induction>;
  /** Whether the documents a Nova draft cited still stand. Free; no model is called. */
  currency(projectId: string, suggestionId: string): Promise<InductionCurrency>;
  /** Nova drafts a whole induction from the project's documents (3 credits). A pending suggestion comes back. */
  draftInduction(projectId: string, siteName: string): Promise<AiSuggestion>;
  /** Nova redrafts the sections a changed document touches (1 credit). A pending suggestion comes back. */
  refreshDraft(projectId: string, suggestionId: string): Promise<AiSuggestion>;
  decideSuggestion(
    projectId: string,
    suggestionId: string,
    decision: 'accepted' | 'edited' | 'rejected',
  ): Promise<void>;
  approve(projectId: string, induction: Induction, section: number): Promise<Induction>;
  publish(projectId: string, induction: Induction, input: PublishInput): Promise<Induction>;
  register(projectId: string): Promise<InductionRegister>;
  listLinks(projectId: string, inductionId: string): Promise<InductionLink[]>;
  createLink(
    projectId: string,
    inductionId: string,
    input: CreateInductionLinkInput,
  ): Promise<InductionLinkCreated>;
  revokeLink(projectId: string, inductionId: string, linkId: string): Promise<InductionLink>;
}

interface Row {
  induction: Induction;
  /** The section JSON each approval was given on, by section index. */
  approved: Map<number, string>;
}

const ACTOR = 'usr_preview';
const SAMPLE: InductionContent = {
  passMark: 80,
  sections: [
    {
      key: 'emergencies_and_first_aid',
      title: 'Emergencies and first aid',
      blocks: [
        {
          type: 'text',
          body: 'The assembly point is at the front gate. First aid is in the site office.',
        },
      ],
    },
    {
      key: 'ppe',
      title: 'PPE',
      blocks: [{ type: 'text', body: 'Hard hat, hi-vis, safety boots and glasses at all times.' }],
    },
  ],
  quiz: [
    {
      id: 'q1',
      section: 'emergencies_and_first_aid',
      question: 'Where is the assembly point?',
      options: ['Front gate', 'Site office', 'Car park'],
      answerIndex: 0,
      critical: true,
    },
  ],
};

/** The Nova draft the preview induction was built from; its cited plan has since moved from revision B to C. */
const PREVIEW_DRAFT_ID = 'ais_PREVIEWDRAFT0000000000001';
const staleDrafts = new Set([PREVIEW_DRAFT_ID]);

const stores = projectStores<Map<string, Row>>(() => {
  const rows = new Map<string, Row>();
  const row = seedRow('Paddington Terraces site induction', SAMPLE, PREVIEW_DRAFT_ID);
  rows.set(row.induction.id, row);
  return rows;
});

function seedRow(title: string, content: InductionContent, draftId: string | null = null): Row {
  const now = nowIso();
  return {
    approved: new Map(),
    induction: {
      id: mockId('ind'),
      projectId: 'preview',
      siteId: null,
      title,
      status: 'draft',
      validityMonths: 12,
      draft: content,
      draftAiSuggestionId: draftId,
      approvals: [],
      problems: [],
      currentVersion: null,
      requiredVersion: null,
      versions: [],
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
  };
}

function refresh(r: Row): Induction {
  const i = r.induction;
  i.approvals = [...r.approved].map(([section, json]) => ({
    section,
    approvedBy: ACTOR,
    approvedAt: i.updatedAt,
    current: JSON.stringify(i.draft.sections[section]) === json,
  }));
  i.problems = [
    ...(i.draft.sections.length
      ? []
      : [{ path: 'sections', message: 'Add at least one section.' }]),
    ...i.draft.sections.flatMap((s, n) =>
      i.approvals.some((a) => a.section === n && a.current)
        ? []
        : [{ path: `sections.${n}`, message: `${s.title} needs approval.` }],
    ),
  ];
  return structuredClone(i);
}

function find(projectId: string, id: string): Row {
  const row = stores.get(projectId).get(id);
  return row ?? problem(404, 'inductions.not_found', 'That induction does not exist.');
}

function touch(r: Row, expected: number): void {
  if (r.induction.version !== expected)
    problem(412, 'common.version_conflict', 'Someone else changed this induction.');
  r.induction.version += 1;
  r.induction.updatedAt = nowIso();
}

/** Links by induction, newest first. Their tokens are never kept, as on the server. */
const previewLinks = new Map<string, InductionLink[]>();

export const inductionBuilderSource: InductionBuilderSource = {
  list: (projectId) => delay([...stores.get(projectId).values()].map((r) => refresh(r))),
  get: (projectId, id) => delay(refresh(find(projectId, id))),
  create(projectId, input) {
    // The server allows one induction per project; later changes are new versions of it.
    if (stores.get(projectId).size)
      problem(
        409,
        'induction.exists',
        'This project already has an induction. Publish a new version of it instead.',
      );
    const row = seedRow(input.title.trim(), emptyContent());
    row.induction.validityMonths = input.validityMonths;
    stores.get(projectId).set(row.induction.id, row);
    return delay(refresh(row));
  },
  update(projectId, induction, patch) {
    const row = find(projectId, induction.id);
    touch(row, induction.version);
    if (patch.title !== undefined) row.induction.title = patch.title.trim();
    if (patch.validityMonths !== undefined) row.induction.validityMonths = patch.validityMonths;
    if (patch.status) row.induction.status = patch.status;
    return delay(refresh(row));
  },
  saveDraft(projectId, induction, content, aiSuggestionId) {
    const row = find(projectId, induction.id);
    touch(row, induction.version);
    row.induction.draft = structuredClone(content);
    if (aiSuggestionId) row.induction.draftAiSuggestionId = aiSuggestionId;
    return delay(refresh(row));
  },
  currency: (_projectId, suggestionId) =>
    delay(
      staleDrafts.has(suggestionId)
        ? {
            suggestionId,
            upToDate: false,
            hiddenChanges: 0,
            changed: [
              {
                sourceType: 'document' as const,
                sourceId: 'doc_PREVIEWSAFETYPLAN000000001',
                title: 'Site safety plan',
                citedRevision: 'B',
                currentRevision: 'C',
                reason: 'newer_revision' as const,
                sections: ['emergencies_and_first_aid' as const],
                quizQuestions: 1,
              },
            ],
          }
        : { suggestionId, upToDate: true, hiddenChanges: 0, changed: [] },
    ),
  draftInduction(_projectId, siteName) {
    return delay({
      id: 'ais_PREVIEWNEWDRAFT00000000001',
      projectId: 'preview',
      task: 'induction.draft',
      targetType: 'induction',
      targetId: null,
      status: 'pending',
      confidence: null,
      runId: 'run_preview',
      createdAt: nowIso(),
      decidedAt: null,
      payload: {
        siteName,
        sections: [
          {
            section: 'emergencies_and_first_aid',
            status: 'covered',
            gap: null,
            slides: [
              {
                title: 'Assembly point',
                points: [{ text: 'Assemble at the front gate.', citations: [] }],
                script: [],
              },
            ],
          },
          {
            section: 'ppe',
            status: 'covered',
            gap: null,
            slides: [
              {
                title: 'PPE',
                points: [{ text: 'Hard hat, hi-vis and boots at all times.', citations: [] }],
                script: [],
              },
            ],
          },
          {
            section: 'high_risk_work_and_permits',
            status: 'missing',
            gap: 'Not found in your project documents. Add this section, or upload the document that covers it.',
            slides: [],
          },
        ],
        quiz: [
          {
            section: 'emergencies_and_first_aid',
            question: 'Where is the assembly point?',
            options: ['Front gate', 'Site office'],
            answerIndex: 0,
            critical: true,
            citations: [],
          },
        ],
        warnings: [{ code: 'uncited', section: 'ppe', text: 'Gloves for all trades.' }],
      },
    });
  },
  refreshDraft(_projectId, suggestionId) {
    if (!staleDrafts.has(suggestionId))
      return problem(
        409,
        'ai.induction.up_to_date',
        'The documents this induction cites have not changed.',
      );
    return delay({
      id: 'ais_PREVIEWREFRESH00000000001',
      projectId: 'preview',
      task: 'induction.refresh',
      targetType: 'induction',
      targetId: null,
      status: 'pending',
      confidence: null,
      runId: 'run_preview',
      createdAt: nowIso(),
      decidedAt: null,
      payload: {
        refresh: {
          baseSuggestionId: suggestionId,
          sections: ['emergencies_and_first_aid'],
          skipped: [],
        },
        sections: [
          {
            section: 'emergencies_and_first_aid',
            status: 'covered',
            gap: null,
            slides: [
              {
                title: 'Assembly point',
                points: [
                  {
                    text: 'Assemble at the car park beside the site office (safety plan rev C).',
                    citations: [],
                  },
                ],
                script: [],
              },
            ],
          },
        ],
        quiz: [
          {
            section: 'emergencies_and_first_aid',
            question: 'Where is the assembly point?',
            options: ['Front gate', 'Car park beside the site office', 'Street'],
            answerIndex: 1,
            critical: true,
            citations: [],
          },
        ],
      },
    });
  },
  decideSuggestion(_projectId, suggestionId, decision) {
    // A refresh the builder took in clears the stale mark from the draft it replaced.
    if (decision !== 'rejected' && suggestionId === 'ais_PREVIEWREFRESH00000000001')
      staleDrafts.clear();
    return delay(undefined);
  },
  approve(projectId, induction, section) {
    const row = find(projectId, induction.id);
    touch(row, induction.version);
    row.approved.set(section, JSON.stringify(row.induction.draft.sections[section]));
    return delay(refresh(row));
  },
  publish(projectId, induction, input) {
    const row = find(projectId, induction.id);
    if (refresh(row).problems.length)
      problem(422, 'inductions.not_publishable', 'Every section needs approval first.');
    touch(row, induction.version);
    const i = row.induction;
    const number = i.versions.length + 1;
    const summary: InductionVersionSummary = {
      id: mockId('inv'),
      number,
      contentHash: `preview-${number}`,
      redo: input.redo,
      graceDays: input.graceDays,
      requiredFrom: nowIso(),
      changeNote: input.changeNote.trim() || null,
      aiGenerated: false,
      publishedAt: nowIso(),
      publishedBy: ACTOR,
    };
    i.versions = [summary, ...i.versions];
    i.currentVersion = summary;
    if (input.redo === 'all' || !i.requiredVersion) i.requiredVersion = summary;
    i.status = 'published';
    return delay(refresh(row));
  },
  listLinks: (_projectId, inductionId) =>
    delay(structuredClone(previewLinks.get(inductionId) ?? [])),
  createLink(_projectId, inductionId, input) {
    const now = nowIso();
    const link: InductionLink = {
      id: mockId('lnk'),
      inductionId,
      label: input.label?.trim() || null,
      recipientEmail: input.recipientEmail ?? null,
      recipientPhone: input.recipientPhone ?? null,
      state: 'active',
      expiresAt: new Date(Date.now() + (input.expiresInDays ?? 30) * 86_400_000).toISOString(),
      maxUses: input.maxUses ?? null,
      useCount: 0,
      lastUsedAt: null,
      createdAt: now,
      createdBy: ACTOR,
      revokedAt: null,
    };
    previewLinks.set(inductionId, [link, ...(previewLinks.get(inductionId) ?? [])]);
    const token = `arl_${'x'.repeat(64)}`;
    return delay({ link: structuredClone(link), token, url: `/i/${token}` });
  },
  revokeLink(_projectId, inductionId, linkId) {
    const link = previewLinks.get(inductionId)?.find((l) => l.id === linkId);
    if (!link) return problem(404, 'links.not_found', 'That link does not exist.');
    link.state = 'revoked';
    link.revokedAt = nowIso();
    return delay(structuredClone(link));
  },
  register: () =>
    delay({
      inductionId: null,
      requiredVersion: null,
      data: [
        {
          worker: {
            id: 'wkr_preview1',
            userId: null,
            companyId: 'cmp_elec',
            companyNameOther: null,
            fullName: 'Sam Worker',
            phone: null,
            email: null,
            kind: 'worker',
            status: 'active',
            version: 1,
          },
          status: 'current',
          completion: {
            id: 'icm_preview1',
            versionNumber: 1,
            completedAt: '2026-10-01T22:00:00.000Z',
            expiresOn: '2027-10-02',
            score: 90,
            method: 'self',
          },
          credentials: [{ kind: 'white_card', status: 'recorded', expiresOn: null }],
        },
      ],
    }),
};

/** Back to the seeded sample, or to a project with no induction yet when `emptyProjectId` is given. */
export function resetInductionBuilderPreview(emptyProjectId?: string): void {
  previewLinks.clear();
  staleDrafts.clear();
  staleDrafts.add(PREVIEW_DRAFT_ID);
  stores.reset();
  if (emptyProjectId) stores.get(emptyProjectId).clear();
}
