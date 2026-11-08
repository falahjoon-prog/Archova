'use client';

import { useState } from 'react';
import {
  Button,
  Dialog,
  Select,
  SignaturePad,
  TextField,
  Textarea,
  type SignatureValue,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { nowProjectLocal, projectLocalToIso } from '../lib/time';
import { signatureToPng } from '../lib/signature';
import {
  CATEGORIES,
  CATEGORY_LABELS,
  type TalkInput,
  type Topic,
  type TopicCategory,
  type TopicInput,
} from '../lib/types';

export interface CompanyOption {
  id: string;
  name: string;
}

export function NewTalkDialog({
  topics,
  companies,
  presenter,
  timeZone,
  initialTopicId,
  pending,
  error,
  onClose,
  onSave,
}: {
  topics: Topic[];
  companies: CompanyOption[];
  presenter: string;
  timeZone: string;
  initialTopicId?: string;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (input: TalkInput) => void;
}) {
  const initial = topics.find((t) => t.id === initialTopicId);
  const [topicId, setTopicId] = useState(initial?.id ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [when, setWhen] = useState(() => nowProjectLocal(timeZone));
  const [by, setBy] = useState(presenter);
  const [location, setLocation] = useState('');
  const [names, setNames] = useState('');
  const [company, setCompany] = useState('');
  const iso = projectLocalToIso(when, timeZone);
  const people = names
    .split('\n')
    .map((n) => n.trim())
    .filter(Boolean);
  return (
    <Dialog
      open
      onClose={onClose}
      title="New toolbox talk"
      description="Record a talk you have held. Add who attended now, or on the attendance grid, then each person signs."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim() || !by.trim() || !iso || pending}
            onClick={() =>
              iso &&
              onSave({
                title: title.trim(),
                heldAt: iso,
                presenterName: by.trim(),
                ...(topicId ? { topicId } : {}),
                ...(location.trim() ? { location: location.trim() } : {}),
                ...(people.length
                  ? {
                      attendees: people.map((personName) => ({
                        personName,
                        ...(company ? { companyId: company } : {}),
                      })),
                    }
                  : {}),
              })
            }
          >
            Create talk
          </Button>
        </>
      }
    >
      <div className="stack">
        <Select
          label="Topic"
          value={topicId}
          placeholder="No topic from the library"
          options={topics.filter((t) => t.isActive).map((t) => ({ value: t.id, label: t.title }))}
          onChange={(e) => {
            const t = topics.find((x) => x.id === e.target.value);
            setTopicId(e.target.value);
            if (t && !title.trim()) setTitle(t.title);
          }}
        />
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <TextField
          label="When"
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
        <TextField label="Presented by" value={by} onChange={(e) => setBy(e.target.value)} />
        <TextField
          label="Location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
        <Textarea
          label="Who attended (one name per line)"
          value={names}
          onChange={(e) => setNames(e.target.value)}
        />
        {people.length ? (
          <Select
            label="Their company"
            value={company}
            placeholder="Not recorded"
            options={companies.map((c) => ({ value: c.id, label: c.name }))}
            onChange={(e) => setCompany(e.target.value)}
          />
        ) : null}
        <ErrorAlert error={error} title="We couldn't create the talk" />
      </div>
    </Dialog>
  );
}

export function AddPeopleDialog({
  companies,
  pending,
  error,
  onClose,
  onSave,
}: {
  companies: CompanyOption[];
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (people: { personName: string; companyId?: string }[]) => void;
}) {
  const [names, setNames] = useState('');
  const [company, setCompany] = useState('');
  const people = names
    .split('\n')
    .map((n) => n.trim())
    .filter(Boolean);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add people"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={people.length === 0 || pending}
            onClick={() =>
              onSave(
                people.map((personName) => ({
                  personName,
                  ...(company ? { companyId: company } : {}),
                })),
              )
            }
          >
            Add to grid
          </Button>
        </>
      }
    >
      <div className="stack">
        <Textarea
          label="Names (one per line)"
          value={names}
          onChange={(e) => setNames(e.target.value)}
        />
        <Select
          label="Company"
          value={company}
          placeholder="Not recorded"
          options={companies.map((c) => ({ value: c.id, label: c.name }))}
          onChange={(e) => setCompany(e.target.value)}
        />
        <ErrorAlert error={error} title="We couldn't add them" />
      </div>
    </Dialog>
  );
}

/** One person signs on the device: drawn, or typed with a confirmation. The image is what the server stores. */
export function SignDialog({
  name,
  pending,
  error,
  onClose,
  onSign,
}: {
  name: string;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSign: (image: Blob) => void;
}) {
  const [value, setValue] = useState<SignatureValue>(null);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Sign for ${name}`}
      description="By signing, you confirm you attended this talk."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!value || pending}
            onClick={() => {
              if (!value) return;
              signatureToPng(value).then(onSign, (e: Error) => setFailed(e.message));
            }}
          >
            Sign
          </Button>
        </>
      }
    >
      <div className="stack">
        <SignaturePad name={name} onChange={setValue} />
        {failed ? <p role="alert">{failed}</p> : null}
        <ErrorAlert error={error} title="We couldn't save the signature" />
      </div>
    </Dialog>
  );
}

export function TopicDialog({
  pending,
  error,
  onClose,
  onSave,
}: {
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (input: TopicInput) => void;
}) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<TopicCategory>('general');
  const [points, setPoints] = useState('');
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add topic"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim() || pending}
            onClick={() =>
              onSave({
                title: title.trim(),
                category,
                ...(points.trim() ? { talkingPoints: points.trim() } : {}),
              })
            }
          >
            Add topic
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Select
          label="Category"
          value={category}
          options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
          onChange={(e) => setCategory(e.target.value as TopicCategory)}
        />
        <Textarea
          label="Talking points"
          value={points}
          onChange={(e) => setPoints(e.target.value)}
        />
        <ErrorAlert error={error} title="We couldn't add the topic" />
      </div>
    </Dialog>
  );
}
