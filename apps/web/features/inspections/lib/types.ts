export type ResponseType =
  'pass_fail_na' | 'yes_no' | 'number' | 'text' | 'photo' | 'signature' | 'select' | 'date';
export type InspectionResult = 'pass' | 'fail' | 'na';
export type InspectionStatus = 'scheduled' | 'in_progress' | 'submitted' | 'closed';

export const RESPONSE_TYPE_LABELS: Record<ResponseType, string> = {
  pass_fail_na: 'Pass, fail or N/A',
  yes_no: 'Yes or no',
  number: 'Number',
  text: 'Text',
  photo: 'Photo',
  signature: 'Signature (typed name)',
  select: 'Choose one',
  date: 'Date',
};

export const STATUS_LABELS: Record<InspectionStatus, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  submitted: 'Submitted',
  closed: 'Closed',
};

export const RESULT_LABELS: Record<InspectionResult, string> = {
  pass: 'Pass',
  fail: 'Fail',
  na: 'N/A',
};

export interface Template {
  id: string;
  name: string;
  /** ITP, pre-pour, handover, safety walk or your own. */
  type: string;
  version: number;
  published: boolean;
}

export interface TemplateItem {
  id: string;
  section: string;
  prompt: string;
  responseType: ResponseType;
  options: string[];
  required: boolean;
  createsDefectOnFail: boolean;
}

export interface TemplateDetail {
  template: Template;
  items: TemplateItem[];
}

export interface TemplateItemInput {
  section?: string;
  prompt: string;
  responseType: ResponseType;
  options?: string[];
  required?: boolean;
  createsDefectOnFail?: boolean;
}

export interface TemplateInput {
  name: string;
  type?: string;
  tradeCategory?:
    | 'fire_safety'
    | 'waterproofing'
    | 'structural'
    | 'external_cladding'
    | 'building_services'
    | 'other';
  items: TemplateItemInput[];
}

export interface Inspection {
  id: string;
  /** `INS-0042` */
  numberLabel: string;
  templateId: string;
  templateVersion: number;
  title: string;
  location: string | null;
  status: InspectionStatus;
  /** `YYYY-MM-DD` */
  scheduledFor: string | null;
  signedByName: string | null;
  version: number;
}

export interface Answer {
  templateItemId: string;
  value: string | number | boolean | null;
  result: InspectionResult | null;
  note: string | null;
}

export interface InspectionDetail {
  inspection: Inspection;
  items: TemplateItem[];
  responses: Answer[];
  missingRequiredItemIds: string[];
  failedItemIds: string[];
}

export interface InspectionFilters {
  status?: InspectionStatus;
}

export interface InspectionInput {
  templateId: string;
  title?: string;
  location?: string;
  scheduledFor?: string;
}

export interface AnswerInput {
  templateItemId: string;
  value?: string | number | boolean;
  result?: InspectionResult;
  note?: string;
}
