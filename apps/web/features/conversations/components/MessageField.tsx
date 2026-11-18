'use client';

import { useMemo, useState } from 'react';
import { Select, Textarea } from '@archova/ui';
import { useProjectMembers } from '@/features/projects';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { insertMention, mentionedIn, type Teammate } from '../lib/mentions';

const BODY_MAX = 5000;

/**
 * The message box with a "Mention a teammate" picker under it. Only people on the project team can be mentioned
 * (guest companies cannot); picking one adds "@Name" to the text. `mentions()` gives the ids still named in it.
 */
export function useMessageField(projectId: string, body: string, setBody: (v: string) => void) {
  const org = useCurrentOrg();
  const members = useProjectMembers(org.orgId, projectId);
  const [picked, setPicked] = useState<Teammate[]>([]);
  const teammates = useMemo<Teammate[]>(
    () =>
      (members.data?.data ?? [])
        .filter((m) => m.status === 'active' && !m.isExternal)
        .map((m) => ({ userId: m.userId, name: m.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [members.data],
  );
  return {
    teammates,
    mentions: () => mentionedIn(body, picked),
    pick(userId: string) {
      const t = teammates.find((x) => x.userId === userId);
      if (!t) return;
      setPicked((p) => (p.some((x) => x.userId === userId) ? p : [...p, t]));
      setBody(insertMention(body, t));
    },
    reset: () => setPicked([]),
  };
}

export function MessageField({
  label,
  rows,
  value,
  onChange,
  field,
  required,
}: {
  label: string;
  rows?: number;
  value: string;
  onChange: (v: string) => void;
  field: ReturnType<typeof useMessageField>;
  required?: boolean;
}) {
  return (
    <div className="stack">
      <Textarea
        label={label}
        rows={rows}
        value={value}
        maxLength={BODY_MAX}
        onChange={(e) => onChange(e.target.value)}
        required={required}
      />
      {field.teammates.length > 0 ? (
        <Select
          label="Mention a teammate"
          placeholder="Choose someone to notify"
          value=""
          options={field.teammates.map((t) => ({ value: t.userId, label: t.name }))}
          onChange={(e) => field.pick(e.target.value)}
          hint="They get a notification with a link to this conversation."
        />
      ) : null}
    </div>
  );
}
