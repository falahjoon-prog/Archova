import { encodeId } from '@archova/domain';
import type {
  GeotechEarthworksEntry,
  GeotechFlag,
  GeotechInvestigation,
  GeotechTest,
} from '@archova/contracts';
import { investigationLabel, type GeotechFlag as Flag } from '../domain/geotech';
import type { EarthworksRow, InvestigationRow, TestView } from '../application/geotech';

export const toInvestigationDto = (r: InvestigationRow): GeotechInvestigation => ({
  id: encodeId('geotechInvestigation', r.id),
  projectId: encodeId('project', r.projectId),
  number: r.number,
  numberLabel: investigationLabel(r.number),
  kind: r.kind,
  title: r.title,
  location: r.location,
  latitude: r.latitude,
  longitude: r.longitude,
  depthM: r.depthM,
  groundwaterDepthM: r.groundwaterDepthM,
  investigatedOn: r.investigatedOn,
  consultantCompanyId: r.consultantCompanyId ? encodeId('company', r.consultantCompanyId) : null,
  summary: r.summary,
  fileIds: r.fileIds.map((f) => encodeId('file', f)),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  version: r.version,
});

export const toTestDto = (r: TestView): GeotechTest => ({
  id: encodeId('geotechTest', r.id),
  projectId: encodeId('project', r.projectId),
  investigationId: r.investigationId ? encodeId('geotechInvestigation', r.investigationId) : null,
  kind: r.kind,
  sampleRef: r.sampleRef,
  zone: r.zone,
  depthFromM: r.depthFromM,
  depthToM: r.depthToM,
  value: r.value,
  unit: r.unit,
  specMin: r.specMin,
  specMax: r.specMax,
  result: r.result,
  testedOn: r.testedOn,
  lab: r.lab,
  notes: r.notes,
  createdAt: r.createdAt.toISOString(),
});

export const toEarthworksDto = (r: EarthworksRow): GeotechEarthworksEntry => ({
  id: encodeId('geotechEarthworks', r.id),
  projectId: encodeId('project', r.projectId),
  zone: r.zone,
  kind: r.kind,
  volumeM3: r.volumeM3,
  material: r.material,
  recordedOn: r.recordedOn,
  notes: r.notes,
  createdAt: r.createdAt.toISOString(),
});

export const toFlagDto = (f: Flag): GeotechFlag => ({
  kind: f.kind,
  severity: f.severity,
  title: f.title,
  detail: f.detail,
  refId: f.refId
    ? encodeId(f.kind === 'failed_test' ? 'geotechTest' : 'geotechInvestigation', f.refId)
    : null,
});
