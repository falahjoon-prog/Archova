'use client';

import { Select } from '@archova/ui';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useContracts, useVariations } from '@/features/claims';
import { formatDefectNumber, useDefectList } from '@/features/defects';
import { formatRfiNumber, useRfiList } from '@/features/rfis';
import { useState } from 'react';
import type { MeetingItem } from '../data/api';

export type PickedLink = NonNullable<MeetingItem['link']>;
type LinkType = PickedLink['type'];

const TYPE_OPTIONS = [
  { value: 'rfi', label: 'An RFI' },
  { value: 'defect', label: 'A defect' },
  { value: 'variation', label: 'A variation' },
];

const MAX_LABEL = 70;
const clip = (s: string) => (s.length > MAX_LABEL ? `${s.slice(0, MAX_LABEL - 1)}…` : s);

function RfiSelect({ value, onPick }: Props) {
  const { projectId } = useCurrentProject();
  const list = useRfiList(projectId, {});
  return (
    <Select
      label="RFI"
      placeholder={list.isPending ? 'Loading…' : 'Choose an RFI'}
      options={(list.data ?? []).map((r) => ({
        value: r.id,
        label: clip(`${formatRfiNumber(r.number)}  ${r.subject}`),
      }))}
      value={value}
      onChange={(e) => onPick(e.target.value)}
    />
  );
}

function DefectSelect({ value, onPick }: Props) {
  const list = useDefectList({});
  return (
    <Select
      label="Defect"
      placeholder={list.isPending ? 'Loading…' : 'Choose a defect'}
      options={(list.data ?? []).map((d) => ({
        value: d.id,
        label: clip(`${formatDefectNumber(d.number)}  ${d.title}`),
      }))}
      value={value}
      onChange={(e) => onPick(e.target.value)}
    />
  );
}

function VariationSelect({ value, onPick }: Props) {
  const { projectId } = useCurrentProject();
  const contracts = useContracts(projectId);
  const [contractId, setContractId] = useState('');
  const all = contracts.data ?? [];
  const chosen = contractId || (all.length === 1 ? (all[0]?.id ?? '') : '');
  const variations = useVariations(projectId, chosen);
  return (
    <>
      {all.length > 1 ? (
        <Select
          label="Contract"
          placeholder="Choose a contract"
          options={all.map((c) => ({ value: c.id, label: clip(c.title) }))}
          value={contractId}
          onChange={(e) => {
            setContractId(e.target.value);
            onPick('');
          }}
        />
      ) : null}
      <Select
        label="Variation"
        placeholder={
          contracts.isPending
            ? 'Loading…'
            : all.length === 0
              ? 'No contracts on this project'
              : 'Choose a variation'
        }
        disabled={!chosen}
        options={(chosen ? (variations.data?.data ?? []) : []).map((v) => ({
          value: v.id,
          label: clip(`VAR-${String(v.number).padStart(3, '0')}  ${v.title}`),
        }))}
        value={value}
        onChange={(e) => onPick(e.target.value)}
      />
    </>
  );
}

interface Props {
  value: string;
  onPick: (id: string) => void;
}

/** Pick an RFI, defect or variation to attach to a minutes item (MTG-US4). `null` means no link. */
export function LinkPicker({ onChange }: { onChange: (link: PickedLink | null) => void }) {
  const [type, setType] = useState<LinkType | ''>('');
  const [id, setId] = useState('');
  const pick = (t: LinkType | '', next: string) => {
    setType(t);
    setId(next);
    onChange(t && next ? { type: t, id: next } : null);
  };
  return (
    <>
      <Select
        label="Link to"
        placeholder="Nothing"
        options={TYPE_OPTIONS}
        value={type}
        onChange={(e) => pick(e.target.value as LinkType | '', '')}
      />
      {type === 'rfi' ? <RfiSelect value={id} onPick={(v) => pick('rfi', v)} /> : null}
      {type === 'defect' ? <DefectSelect value={id} onPick={(v) => pick('defect', v)} /> : null}
      {type === 'variation' ? (
        <VariationSelect value={id} onPick={(v) => pick('variation', v)} />
      ) : null}
    </>
  );
}
