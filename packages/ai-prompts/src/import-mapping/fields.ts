// What a spreadsheet import can fill, per kind of record (integrations/07 §3). Nova suggests which column goes to
// which field; the import screen shows these same fields so a person can change any suggestion. Aliases are the
// words other tools' exports and builders' own registers use for the field, lower case. The importer for each
// record owns the real validation; this is the list of places a column can go.

export const IMPORT_ENTITIES = ['rfi', 'defect', 'drawing_register', 'company'] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

export type ImportFieldKind = 'text' | 'number' | 'date' | 'enum' | 'email' | 'phone' | 'abn';

export interface ImportFieldValue {
  /** What Archova stores. */
  value: string;
  label: string;
  /** What other tools and builders call it, lower case. */
  aliases: readonly string[];
}

export interface ImportField {
  key: string;
  label: string;
  kind: ImportFieldKind;
  /** The importer can't create the record without it. */
  required: boolean;
  aliases: readonly string[];
  /** For `enum` fields: the values Archova stores. */
  values?: readonly ImportFieldValue[];
}

const f = (
  key: string,
  label: string,
  kind: ImportFieldKind,
  required: boolean,
  aliases: readonly string[],
  values?: readonly ImportFieldValue[],
): ImportField => ({ key, label, kind, required, aliases, ...(values ? { values } : {}) });

const v = (value: string, label: string, aliases: readonly string[]): ImportFieldValue => ({
  value,
  label,
  aliases,
});

export const IMPORT_FIELDS: Readonly<Record<ImportEntity, readonly ImportField[]>> = {
  rfi: [
    f('number', 'RFI number', 'number', true, [
      'number',
      'no',
      'no.',
      '#',
      'rfi no',
      'rfi number',
      'rfi #',
      'ref',
      'reference',
      'mail no',
    ]),
    f('subject', 'Subject', 'text', true, [
      'subject',
      'title',
      'rfi title',
      'rfi subject',
      'description of query',
      'name',
    ]),
    f('question', 'Question', 'text', false, [
      'question',
      'query',
      'rfi question',
      'request',
      'details',
      'description',
      'issue',
    ]),
    f(
      'status',
      'Status',
      'enum',
      true,
      ['status', 'rfi status', 'state'],
      [
        v('open', 'Open', [
          'open',
          'issued',
          'sent',
          'pending',
          'pending response',
          'outstanding',
          'awaiting response',
          'in review',
        ]),
        v('answered', 'Answered', ['answered', 'responded', 'replied', 'response received']),
        v('closed', 'Closed', [
          'closed',
          'complete',
          'completed',
          'resolved',
          'closed - answered',
          'closed answered',
        ]),
        v('void', 'Void', ['void', 'voided', 'cancelled', 'canceled', 'withdrawn']),
      ],
    ),
    f('dueDate', 'Due date', 'date', false, [
      'due date',
      'due',
      'response due',
      'response required by',
      'required by',
      'date required',
      'reply by',
      'needed by',
    ]),
    f('openedAt', 'Date raised', 'date', true, [
      'date raised',
      'date initiated',
      'date opened',
      'date sent',
      'date issued',
      'created',
      'created date',
      'created at',
      'raised',
      'issued',
      'date',
    ]),
    f('answeredAt', 'Date answered', 'date', false, [
      'date answered',
      'answered',
      'response date',
      'date responded',
      'date replied',
      'replied',
    ]),
    f('closedAt', 'Date closed', 'date', false, [
      'date closed',
      'closed',
      'closed date',
      'closed at',
      'completion date',
    ]),
    f('authorName', 'Raised by', 'text', false, [
      'raised by',
      'created by',
      'author',
      'initiator',
      'originator',
      'from',
      'received from',
    ]),
    f('authorEmail', 'Raised by (email)', 'email', false, [
      'raised by email',
      'created by email',
      'author email',
      'from email',
    ]),
    f('assignee', 'Assigned to', 'text', false, [
      'assigned to',
      'assignee',
      'ball in court',
      'responsible contractor',
      'responsible',
      'to',
      'action by',
    ]),
    f('officialResponse', 'Official response', 'text', false, [
      'official response',
      'response',
      'answer',
      'reply',
      'response text',
    ]),
    f('responseBy', 'Responded by', 'text', false, [
      'responded by',
      'answered by',
      'response by',
      'replied by',
    ]),
  ],
  defect: [
    f('number', 'Defect number', 'number', false, [
      'number',
      'no',
      'no.',
      '#',
      'item #',
      'item no',
      'defect no',
      'defect number',
      'ref',
    ]),
    f('title', 'Title', 'text', true, [
      'title',
      'defect',
      'issue',
      'item',
      'summary',
      'name',
      'defect title',
    ]),
    f('description', 'Description', 'text', false, [
      'description',
      'details',
      'notes',
      'comments',
      'defect description',
    ]),
    f(
      'status',
      'Status',
      'enum',
      true,
      ['status', 'state', 'defect status'],
      [
        v('draft', 'Draft', ['draft', 'initiated', 'new', 'logged']),
        v('open', 'Open', [
          'open',
          'work required',
          'in progress',
          'outstanding',
          'issued',
          'to do',
          'not started',
        ]),
        v('ready_for_review', 'Ready for review', [
          'ready for review',
          'ready to close',
          'rectified',
          'fixed',
          'complete',
          'completed',
          'pending review',
          'for inspection',
        ]),
        v('closed', 'Closed', ['closed', 'resolved', 'accepted', 'signed off', 'done']),
        v('disputed', 'Disputed', ['disputed', 'rejected', 'not accepted', 'contested']),
        v('void', 'Void', ['void', 'voided', 'cancelled', 'canceled', 'deleted', 'duplicate']),
      ],
    ),
    f(
      'priority',
      'Priority',
      'enum',
      false,
      ['priority', 'severity', 'urgency'],
      [
        v('low', 'Low', ['low', 'minor', 'cosmetic', 'p4']),
        v('medium', 'Medium', ['medium', 'normal', 'moderate', 'standard', 'p3']),
        v('high', 'High', ['high', 'major', 'important', 'p2']),
        v('critical', 'Critical', ['critical', 'urgent', 'severe', 'p1', 'safety']),
      ],
    ),
    f('trade', 'Trade', 'text', false, ['trade', 'discipline', 'work type', 'trade responsible']),
    f('category', 'Defect type', 'text', false, [
      'category',
      'type',
      'defect type',
      'issue type',
      'classification',
    ]),
    f('location', 'Location', 'text', false, [
      'location',
      'room',
      'area',
      'unit',
      'level',
      'apartment',
      'zone',
    ]),
    f('assigneeCompany', 'Assigned company', 'text', false, [
      'assigned to',
      'assignee',
      'responsible company',
      'responsible contractor',
      'contractor',
      'subcontractor',
      'subbie',
      'company',
    ]),
    f('dueDate', 'Due date', 'date', false, ['due date', 'due', 'target date', 'fix by']),
    f('raisedBy', 'Raised by', 'text', false, [
      'raised by',
      'created by',
      'reported by',
      'inspector',
      'identified by',
    ]),
    f('raisedAt', 'Date raised', 'date', false, [
      'date raised',
      'date created',
      'created',
      'created at',
      'date identified',
      'reported',
      'date',
    ]),
    f('closedAt', 'Date closed', 'date', false, [
      'date closed',
      'closed date',
      'closed at',
      'completed date',
      'date completed',
    ]),
  ],
  drawing_register: [
    f('sheetNumber', 'Drawing number', 'text', true, [
      'drawing number',
      'drawing no',
      'drawing no.',
      'dwg no',
      'dwg number',
      'sheet number',
      'sheet no',
      'document number',
      'document no',
      'doc no',
      'number',
    ]),
    f('title', 'Title', 'text', true, [
      'title',
      'drawing title',
      'sheet title',
      'document title',
      'name',
      'description',
    ]),
    f('revision', 'Revision', 'text', true, ['revision', 'rev', 'rev.', 'issue', 'version']),
    f('revisionDate', 'Revision date', 'date', false, [
      'revision date',
      'rev date',
      'date',
      'date issued',
      'issue date',
      'issued',
    ]),
    f('discipline', 'Discipline', 'text', false, [
      'discipline',
      'disc',
      'disc.',
      'trade',
      'category',
    ]),
    f(
      'status',
      'Status',
      'enum',
      false,
      ['status', 'state'],
      [
        v('current', 'Current', [
          'current',
          'latest',
          'for construction',
          'issued for construction',
          'ifc',
          'approved',
        ]),
        v('superseded', 'Superseded', ['superseded', 'obsolete', 'replaced', 'void', 'historic']),
      ],
    ),
  ],
  company: [
    f('name', 'Company name', 'text', true, [
      'company',
      'company name',
      'name',
      'organisation',
      'organization',
      'business name',
      'trading name',
      'supplier',
      'vendor',
    ]),
    f('abn', 'ABN', 'abn', false, ['abn', 'australian business number', 'business number']),
    f('trades', 'Trades', 'text', false, [
      'trade',
      'trades',
      'speciality',
      'specialty',
      'work type',
      'type of work',
      'discipline',
    ]),
    f('contactName', 'Contact name', 'text', false, [
      'contact',
      'contact name',
      'primary contact',
      'attention',
      'representative',
    ]),
    f('email', 'Email', 'email', false, ['email', 'email address', 'e-mail', 'contact email']),
    f('phone', 'Phone', 'phone', false, [
      'phone',
      'phone number',
      'mobile',
      'telephone',
      'tel',
      'contact number',
    ]),
    f('address', 'Address', 'text', false, [
      'address',
      'street address',
      'postal address',
      'business address',
    ]),
  ],
};

export const fieldsOf = (entity: ImportEntity): readonly ImportField[] => IMPORT_FIELDS[entity];
