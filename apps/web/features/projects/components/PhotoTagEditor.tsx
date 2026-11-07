'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Select, TextField } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import {
  savePhotoTags,
  suggestPhotoTags,
  type ProjectPhoto,
  type PhotoTagInput,
} from '../data/photos';
import { PHOTO_TRADE_OPTIONS, parseTags, tradeLabel } from '../lib/photo-labels';

/**
 * Where, which trade and what: the tags that file a photo in the project library. Nova can suggest them from the
 * photo; nothing is kept until the person saves, and they can change anything first.
 */
export function PhotoTagEditor({
  orgId,
  projectId,
  photo,
  knownAreas,
  onSaved,
}: {
  orgId: string;
  projectId: string;
  photo: ProjectPhoto;
  knownAreas: string[];
  onSaved: () => void;
}) {
  const current = photo.tags;
  const [area, setArea] = useState(current?.area ?? '');
  const [trade, setTrade] = useState(current?.trade ?? '');
  const [tags, setTags] = useState((current?.tags ?? []).join(', '));
  const [runId, setRunId] = useState<string | null>(null);
  const [filled, setFilled] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const suggest = useMutation({
    mutationFn: () => suggestPhotoTags(orgId, projectId, photo.file.id, knownAreas),
    onSuccess: (s) => {
      setRunId(s.runId);
      setFilled(true);
      setNote(
        s.photoUnclear
          ? 'Nova could not make this photo out. Fill the tags in yourself if you want them.'
          : s.area || s.trade || s.tags.length
            ? 'Nova suggested these from the photo. Check them, then save.'
            : 'Nova could not tell where or what this is. Add tags yourself if you want them.',
      );
      if (s.area) setArea(s.area);
      if (s.trade) setTrade(s.trade);
      if (s.tags.length) setTags(s.tags.join(', '));
    },
  });
  const save = useMutation({
    mutationFn: () => {
      const body: PhotoTagInput = {
        area: area.trim() || null,
        trade: trade || null,
        tags: parseTags(tags),
        ...(runId ? { novaRunId: runId } : {}),
      };
      return savePhotoTags(orgId, projectId, photo.file.id, body);
    },
    onSuccess: onSaved,
  });

  const options =
    trade && !PHOTO_TRADE_OPTIONS.some((o) => o.value === trade)
      ? [...PHOTO_TRADE_OPTIONS, { value: trade, label: tradeLabel(trade) }]
      : PHOTO_TRADE_OPTIONS;

  return (
    <form
      className="stack photo-tags"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="photo-tags__bar">
        <Button
          type="button"
          variant="secondary"
          loading={suggest.isPending}
          onClick={() => suggest.mutate()}
        >
          Suggest tags with Nova
        </Button>
        {note ? <p className="u-caption">{note}</p> : null}
      </div>
      <ErrorAlert error={suggest.error} title="Nova couldn't suggest tags" />
      <TextField
        label="Area"
        value={area}
        maxLength={60}
        list="photo-areas"
        aiFilled={filled}
        onChange={(e) => {
          setArea(e.target.value);
          setFilled(false);
        }}
        hint="Where on the job, for example Level 2."
      />
      <datalist id="photo-areas">
        {knownAreas.map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>
      <Select
        label="Trade"
        value={trade}
        placeholder="Not set"
        options={options}
        onChange={(e) => setTrade(e.target.value)}
      />
      <TextField
        label="Tags"
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        hint="Up to five, separated by commas."
      />
      <ErrorAlert error={save.error} title="We couldn't save the tags" />
      <div>
        <Button type="submit" loading={save.isPending}>
          Save tags
        </Button>
      </div>
    </form>
  );
}
