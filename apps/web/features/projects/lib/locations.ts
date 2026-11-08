import type { LocationKind } from '@archova/domain';
import type { CreateLocation, ProjectLocation } from '../data/locations';

export const KIND_LABELS: Record<LocationKind, string> = {
  site_office: 'Site office',
  gate: 'Gate or entrance',
  laydown: 'Material laydown',
  parking: 'Parking',
  hospital: 'Nearest hospital',
  other: 'Other',
};

export interface LocationDraft {
  name: string;
  kind: LocationKind;
  address: string;
  accessNote: string;
  contactName: string;
  contactPhone: string;
  usedFor: string;
  isDefault: boolean;
}

export const emptyDraft = (): LocationDraft => ({
  name: '',
  kind: 'site_office',
  address: '',
  accessNote: '',
  contactName: '',
  contactPhone: '',
  usedFor: '',
  isDefault: false,
});

export const draftOf = (l: ProjectLocation): LocationDraft => ({
  name: l.name,
  kind: l.kind,
  address: l.address ?? '',
  accessNote: l.accessNote ?? '',
  contactName: l.contactName ?? '',
  contactPhone: l.contactPhone ?? '',
  usedFor: l.usedFor.join(', '),
  isDefault: l.isDefault,
});

export const parseTags = (s: string) => [
  ...new Set(
    s
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  ),
];

/** The request body for a draft. Without a saved pin, the address is what Get Directions uses. */
export function toBody(d: LocationDraft): CreateLocation {
  return {
    name: d.name.trim(),
    kind: d.kind,
    address: d.address.trim() || null,
    accessNote: d.accessNote.trim() || null,
    contactName: d.contactName.trim() || null,
    contactPhone: d.contactPhone.trim() || null,
    usedFor: parseTags(d.usedFor),
    isDefault: d.isDefault,
  };
}
