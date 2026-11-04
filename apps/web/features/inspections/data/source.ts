// Inspections data source, mirroring `{p}/inspection-templates` and `{p}/inspections` (quality module).
// Preview: in-memory store; photos are not supported in the preview or on web yet.

import { delay, mockId, problem, projectStores } from '@/shared/mocks/runtime';
import type {
  Answer,
  AnswerInput,
  Inspection,
  InspectionDetail,
  InspectionFilters,
  InspectionInput,
  Template,
  TemplateDetail,
  TemplateInput,
  TemplateItem,
} from '../lib/types';

export interface InspectionsSource {
  templates(projectId: string): Promise<Template[]>;
  template(projectId: string, id: string): Promise<TemplateDetail>;
  createTemplate(projectId: string, input: TemplateInput): Promise<TemplateDetail>;
  publishTemplate(projectId: string, id: string): Promise<TemplateDetail>;
  newVersion(projectId: string, id: string): Promise<TemplateDetail>;
  list(projectId: string, filters: InspectionFilters): Promise<Inspection[]>;
  get(projectId: string, id: string): Promise<InspectionDetail>;
  start(projectId: string, input: InspectionInput): Promise<InspectionDetail>;
  record(projectId: string, id: string, answers: AnswerInput[]): Promise<InspectionDetail>;
  submit(projectId: string, d: InspectionDetail, signedByName: string): Promise<InspectionDetail>;
  close(projectId: string, d: InspectionDetail): Promise<InspectionDetail>;
}

interface Run {
  inspection: Inspection;
  answers: Answer[];
}
interface Store {
  templates: TemplateDetail[];
  runs: Run[];
  next: number;
}

const item = (
  id: string,
  prompt: string,
  responseType: TemplateItem['responseType'],
  over: Partial<TemplateItem> = {},
): TemplateItem => ({
  id,
  section: 'Pre-pour',
  prompt,
  responseType,
  options: [],
  required: true,
  createsDefectOnFail: false,
  ...over,
});

const stores = projectStores<Store>(() => ({
  next: 1,
  runs: [],
  templates: [
    {
      template: {
        id: 'itp_pour',
        name: 'Pre-pour check',
        type: 'pre-pour',
        version: 1,
        published: true,
      },
      items: [
        item('iti_1', 'Reinforcement matches the drawings', 'pass_fail_na', {
          createsDefectOnFail: true,
        }),
        item('iti_2', 'Formwork is clean and braced', 'yes_no'),
        item('iti_3', 'Slump (mm)', 'number'),
        item('iti_4', 'Concrete mix', 'select', { options: ['N32', 'N40', 'N50'] }),
        item('iti_5', 'Comments', 'text', { required: false }),
      ],
    },
    {
      template: {
        id: 'itp_draft',
        name: 'Handover walk',
        type: 'handover',
        version: 1,
        published: false,
      },
      items: [item('iti_6', 'Keys handed over', 'yes_no', { section: 'Handover' })],
    },
  ],
}));

const findTemplate = (projectId: string, id: string) => {
  const t = stores.get(projectId).templates.find((x) => x.template.id === id);
  if (!t) problem(404, 'not_found', 'Checklist not found.');
  return t;
};
const findRun = (projectId: string, id: string) => {
  const r = stores.get(projectId).runs.find((x) => x.inspection.id === id);
  if (!r) problem(404, 'not_found', 'Inspection not found.');
  return r;
};

function detailOf(projectId: string, run: Run): InspectionDetail {
  const items = findTemplate(projectId, run.inspection.templateId).items;
  const answered = (a: Answer | undefined) =>
    !!a && (a.result !== null || (a.value !== null && a.value !== ''));
  return {
    inspection: { ...run.inspection },
    items: items.map((i) => ({ ...i })),
    responses: run.answers.map((a) => ({ ...a })),
    missingRequiredItemIds: items
      .filter((i) => i.required && !answered(run.answers.find((a) => a.templateItemId === i.id)))
      .map((i) => i.id),
    failedItemIds: run.answers.filter((a) => a.result === 'fail').map((a) => a.templateItemId),
  };
}

export const inspectionsPreview: InspectionsSource = {
  templates: (projectId) => delay(stores.get(projectId).templates.map((t) => ({ ...t.template }))),
  template: (projectId, id) => delay(structuredClone(findTemplate(projectId, id))),
  createTemplate: (projectId, input) => {
    const t: TemplateDetail = {
      template: {
        id: mockId('itp'),
        name: input.name,
        type: input.type ?? 'checklist',
        version: 1,
        published: false,
      },
      items: input.items.map((i) =>
        item(mockId('iti'), i.prompt, i.responseType, {
          section: i.section ?? '',
          options: i.options ?? [],
          required: i.required ?? true,
          createsDefectOnFail: i.createsDefectOnFail ?? false,
        }),
      ),
    };
    stores.get(projectId).templates.unshift(t);
    return delay(structuredClone(t));
  },
  publishTemplate: (projectId, id) => {
    const t = findTemplate(projectId, id);
    t.template.published = true;
    return delay(structuredClone(t));
  },
  newVersion: (projectId, id) => {
    const t = findTemplate(projectId, id);
    if (!t.template.published)
      problem(409, 'inspection.template_draft', 'Only a published checklist can be versioned.');
    const copy: TemplateDetail = {
      template: {
        ...t.template,
        id: mockId('itp'),
        version: t.template.version + 1,
        published: false,
      },
      items: t.items.map((i) => ({ ...i, id: mockId('iti') })),
    };
    stores.get(projectId).templates.unshift(copy);
    return delay(structuredClone(copy));
  },
  list: (projectId, f) =>
    delay(
      stores
        .get(projectId)
        .runs.filter((r) => !f.status || r.inspection.status === f.status)
        .map((r) => ({ ...r.inspection })),
    ),
  get: (projectId, id) => delay(detailOf(projectId, findRun(projectId, id))),
  start: (projectId, input) => {
    const s = stores.get(projectId);
    const t = findTemplate(projectId, input.templateId);
    if (!t.template.published)
      problem(409, 'inspection.template_draft', 'Publish the checklist first.');
    const run: Run = {
      answers: [],
      inspection: {
        id: mockId('ins'),
        numberLabel: `INS-${String(s.next++).padStart(4, '0')}`,
        templateId: t.template.id,
        templateVersion: t.template.version,
        title: input.title ?? t.template.name,
        location: input.location ?? null,
        status: 'scheduled',
        scheduledFor: input.scheduledFor ?? null,
        signedByName: null,
        version: 1,
      },
    };
    s.runs.unshift(run);
    return delay(detailOf(projectId, run));
  },
  record: (projectId, id, answers) => {
    const run = findRun(projectId, id);
    if (run.inspection.status === 'submitted' || run.inspection.status === 'closed') {
      problem(409, 'inspection.locked', 'This inspection has been submitted.');
    }
    for (const a of answers) {
      const next: Answer = {
        templateItemId: a.templateItemId,
        value: a.value ?? null,
        result: a.result ?? null,
        note: a.note ?? null,
      };
      const i = run.answers.findIndex((x) => x.templateItemId === a.templateItemId);
      if (i >= 0) run.answers[i] = next;
      else run.answers.push(next);
    }
    run.inspection.status = 'in_progress';
    return delay(detailOf(projectId, run));
  },
  submit: (projectId, d, signedByName) => {
    const run = findRun(projectId, d.inspection.id);
    const cur = detailOf(projectId, run);
    if (cur.missingRequiredItemIds.length)
      problem(422, 'inspection.incomplete', 'Answer every required item first.');
    run.inspection.status = 'submitted';
    run.inspection.signedByName = signedByName;
    run.inspection.version += 1;
    return delay(detailOf(projectId, run));
  },
  close: (projectId, d) => {
    const run = findRun(projectId, d.inspection.id);
    if (run.inspection.status !== 'submitted')
      problem(409, 'inspection.not_submitted', 'Submit it first.');
    run.inspection.status = 'closed';
    run.inspection.version += 1;
    return delay(detailOf(projectId, run));
  },
};

export function resetInspectionsPreview() {
  stores.reset();
}
