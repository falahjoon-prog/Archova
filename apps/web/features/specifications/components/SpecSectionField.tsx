'use client';

import { useDeferredValue, useId } from 'react';
import { TextField } from '@archova/ui';
import { useSpecSectionSuggestions } from '../hooks/useSpecifications';

/** "03 30 00 Cast-in-place concrete", the way a spec reference is written on an RFI or submittal. */
export const sectionLabel = (s: { sectionNumber: string; title: string }) =>
  `${s.sectionNumber} ${s.title}`;

/** A free-text spec reference that suggests sections from the project's current spec books while typing. */
export function SpecSectionField({
  value,
  onChange,
  label = 'Spec section',
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
}) {
  const listId = useId();
  const suggestions = useSpecSectionSuggestions(useDeferredValue(value));
  return (
    <>
      <TextField
        label={label}
        placeholder={placeholder}
        value={value}
        list={listId}
        autoComplete="off"
        maxLength={200}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {(suggestions.data ?? []).map((h) => (
          <option key={h.section.id} value={sectionLabel(h.section)} label={h.bookName} />
        ))}
      </datalist>
    </>
  );
}
