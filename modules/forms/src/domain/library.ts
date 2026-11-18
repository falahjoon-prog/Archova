// Built-in templates: the common site forms (compliance 03). They live in code, so every organisation has them from
// the start and they improve with releases. A builder who wants to change one copies it into their own templates.
import type { FormCategory, FormField, LinkModule } from './fields';

export interface LibraryTemplate {
  key: string;
  name: string;
  description: string;
  category: FormCategory;
  linkModule: LinkModule | null;
  cadenceDays: number | null;
  fields: FormField[];
}

const text = (key: string, label: string, required = false): FormField => ({
  key,
  type: 'text',
  label,
  ...(required ? { required } : {}),
});
const long = (key: string, label: string, required = false): FormField => ({
  key,
  type: 'longtext',
  label,
  ...(required ? { required } : {}),
});
const date = (key: string, label: string, required = false): FormField => ({
  key,
  type: 'date',
  label,
  ...(required ? { required } : {}),
});
const crew = (slots = 10): FormField => ({
  key: 'crew_signoff',
  type: 'signature',
  label: 'Crew sign-off',
  help: 'Everyone who has read this and understands it signs here.',
  required: true,
  slots,
});
const photos = (key = 'photos', label = 'Photos'): FormField => ({ key, type: 'photo', label });
const checklist = (key: string, label: string, options: string[]): FormField => ({
  key,
  type: 'checklist',
  label,
  options,
});

export const LIBRARY: readonly LibraryTemplate[] = [
  {
    key: 'job-hazard-analysis',
    name: 'Job Hazard Analysis',
    description:
      'Break a job into steps, name the hazards and agree the controls before the crew starts.',
    category: 'safety',
    linkModule: 'attendance',
    cadenceDays: 7,
    fields: [
      long('instructions', 'Instructions'),
      text('task', 'Task or work area', true),
      {
        key: 'analysis',
        type: 'table',
        label: 'Job steps, hazards and controls',
        required: true,
        columns: [
          { key: 'job_description', label: 'Job description' },
          { key: 'hazard', label: 'Hazard identification' },
          { key: 'controls', label: 'Hazard controls' },
        ],
        rows: 3,
      },
      crew(),
    ],
  },
  {
    key: 'toolbox-talk',
    name: 'Toolbox Talk',
    description: 'A short safety talk with the crew and who attended.',
    category: 'safety',
    linkModule: 'attendance',
    cadenceDays: 7,
    fields: [
      text('topic', 'Topic', true),
      date('talk_date', 'Date', true),
      long('notes', 'Points covered', true),
      long('actions', 'Issues raised and actions'),
      crew(15),
    ],
  },
  {
    key: 'hot-work-permit',
    name: 'Hot Work Permit',
    description: 'Permission to weld, grind or cut, with the fire precautions checked first.',
    category: 'safety',
    linkModule: null,
    cadenceDays: null,
    fields: [
      text('location', 'Location of hot work', true),
      date('permit_date', 'Date', true),
      text('time_window', 'Valid from / to', true),
      checklist('precautions', 'Precautions checked', [
        'Flammables removed or covered within 10 m',
        'Fire extinguisher at the work area',
        'Fire watch assigned for the work and 30 minutes after',
        'Smoke detectors isolated and the isolation recorded',
        'Area inspected after the work',
      ]),
      { key: 'issuer', type: 'signature', label: 'Issued by', required: true, slots: 1 },
      { key: 'worker', type: 'signature', label: 'Received by', required: true, slots: 1 },
    ],
  },
  {
    key: 'critical-lift',
    name: 'Critical Lift',
    description: 'Plan for a lift that is heavy, near people, or near services.',
    category: 'safety',
    linkModule: null,
    cadenceDays: null,
    fields: [
      text('description', 'What is being lifted', true),
      { key: 'load_kg', type: 'number', label: 'Load weight (kg)', required: true },
      text('crane', 'Crane or lifting plant', true),
      long('lift_plan', 'Lift plan and exclusion zone', true),
      checklist('checks', 'Checks', [
        'Ground conditions checked',
        'Slings and shackles inspected',
        'Exclusion zone barricaded',
        'Dogman and driver briefed',
      ]),
      { key: 'sign', type: 'signature', label: 'Lift team', required: true, slots: 4 },
    ],
  },
  {
    key: 'body-injury',
    name: 'Body Injury',
    description:
      'Where on the body a person was hurt, with a short account. Report the incident itself under Incidents.',
    category: 'safety',
    linkModule: 'incidents',
    cadenceDays: null,
    fields: [
      text('person', 'Person injured', true),
      date('injury_date', 'Date of injury', true),
      checklist('areas', 'Body areas affected', [
        'Head',
        'Eyes',
        'Neck',
        'Shoulder',
        'Arm or elbow',
        'Hand or fingers',
        'Back',
        'Chest',
        'Hip or leg',
        'Knee',
        'Foot or ankle',
      ]),
      long('account', 'What happened', true),
      photos(),
      { key: 'sign', type: 'signature', label: 'Reported by', required: true, slots: 1 },
    ],
  },
  {
    key: 'as-built-sketch',
    name: 'As-Built Sketch',
    description: 'Record what was actually built where it differs from the drawings.',
    category: 'quality',
    linkModule: null,
    cadenceDays: null,
    fields: [
      text('location', 'Location', true),
      text('drawing', 'Drawing reference'),
      long('description', 'What was built and how it differs', true),
      {
        key: 'dimensions',
        type: 'table',
        label: 'Measurements',
        columns: [
          { key: 'item', label: 'Item' },
          { key: 'designed', label: 'Designed' },
          { key: 'as_built', label: 'As built' },
        ],
        rows: 3,
      },
      photos('sketch', 'Sketch or photos'),
    ],
  },
  {
    key: 'daily-pre-start',
    name: 'Pre-start Checklist',
    description: 'Daily check of the work area before the crew starts.',
    category: 'site',
    linkModule: 'diary',
    cadenceDays: null,
    fields: [
      checklist('checks', 'Checks', [
        'Access and egress clear',
        'Edge protection in place',
        'Plant inspected',
        'Power leads tagged',
        'First aid kit stocked',
      ]),
      long('issues', 'Issues found'),
      crew(10),
    ],
  },
];

export const libraryId = (key: string) => `library:${key}`;
export const findLibrary = (key: string) => LIBRARY.find((t) => t.key === key) ?? null;
