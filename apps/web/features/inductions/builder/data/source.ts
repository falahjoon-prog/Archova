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
} from '../lib/types';

export interface InductionBuilderSource {
  list(projectId: string): Promise<Induction[]>;
  get(projectId: string, inductionId: string): Promise<Induction>;
  create(projectId: string, input: { title: string; validityMonths: number }): Promise<Induction>;
  update(
    projectId: string,
    induction: Induction,
    patch: { title?: string; validityMonths?: number; status?: 'archived' },
  ): Promise<Induction>;
  saveDraft(projectId: string, induction: Induction, content: InductionContent): Promise<Induction>;
  approve(projectId: string, induction: Induction, section: number): Promise<Induction>;
  publish(projectId: string, induction: Induction, input: PublishInput): Promise<Induction>;
  register(projectId: string): Promise<InductionRegister>;
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

const stores = projectStores<Map<string, Row>>(() => {
  const rows = new Map<string, Row>();
  const row = seedRow('Paddington Terraces site induction', SAMPLE);
  rows.set(row.induction.id, row);
  return rows;
});

function seedRow(title: string, content: InductionContent): Row {
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
      draftAiSuggestionId: null,
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
  saveDraft(projectId, induction, content) {
    const row = find(projectId, induction.id);
    touch(row, induction.version);
    row.induction.draft = structuredClone(content);
    return delay(refresh(row));
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
  stores.reset();
  if (emptyProjectId) stores.get(emptyProjectId).clear();
}
