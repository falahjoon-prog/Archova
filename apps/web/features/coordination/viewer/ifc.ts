// Reads an IFC file in the browser (web-ifc, WebAssembly) into plain elements: world-space triangles plus the
// GlobalId, name and type the coordination screens pin issues to. Nothing leaves the browser; the file is fetched
// from storage by a short-lived signed URL and parsed locally.

import type { IfcAPI } from 'web-ifc';
import { boundsOf, transformPositions, unionBox, type Box } from '../lib/clash';

export interface IfcPart {
  /** World-space x,y,z triples in metres. web-ifc hands them out Y-up (IFC's Z becomes Y), as three.js wants. */
  positions: Float32Array;
  indices: Uint32Array;
  /** Linear RGBA, 0 to 1. */
  color: readonly [number, number, number, number];
}

export interface IfcElement {
  expressId: number;
  guid: string;
  name: string;
  /** IFC entity name as the file spells it, e.g. `IFCWALL`. */
  ifcType: string;
  parts: IfcPart[];
  box: Box;
}

/** Things that carry geometry but are not built elements: they would only produce false clashes. */
const NOT_BUILT = new Set([
  'IFCSPACE',
  'IFCOPENINGELEMENT',
  'IFCANNOTATION',
  'IFCVIRTUALELEMENT',
  'IFCGRID',
]);

/** `IFCWALLSTANDARDCASE` -> `Wall standard case`-ish: just the entity name without the prefix, in sentence case. */
export function friendlyType(ifcType: string): string {
  const t = ifcType.replace(/^IFC/i, '').toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : ifcType;
}

/** Starts web-ifc. `wasmDir` is where `web-ifc.wasm` is served from (browser) and is not used under Node. */
export async function createIfcApi(wasmDir?: string): Promise<IfcAPI> {
  const { IfcAPI } = await import('web-ifc');
  const api = new IfcAPI();
  if (wasmDir) api.SetWasmPath(wasmDir, true);
  await api.Init();
  return api;
}

const text = (v: unknown): string => {
  if (v && typeof v === 'object' && 'value' in v)
    return String((v as { value: unknown }).value ?? '');
  return typeof v === 'string' ? v : '';
};

/** Parses one IFC file. Throws when the bytes are not an IFC model. */
export function parseIfc(api: IfcAPI, bytes: Uint8Array): IfcElement[] {
  // An IFC file is STEP text; refuse anything else before the parser spends time on it.
  if (!new TextDecoder().decode(bytes.subarray(0, 64)).includes('ISO-10303-21'))
    throw new Error('That file is not a readable IFC model.');
  const modelId = api.OpenModel(bytes);
  if (modelId < 0) throw new Error('That file is not a readable IFC model.');
  const elements: IfcElement[] = [];
  try {
    api.StreamAllMeshes(modelId, (mesh) => {
      const expressId = mesh.expressID;
      const ifcType = api.GetNameFromTypeCode(api.GetLineType(modelId, expressId)).toUpperCase();
      if (NOT_BUILT.has(ifcType)) return;
      const parts: IfcPart[] = [];
      let box: Box | null = null;
      for (let i = 0; i < mesh.geometries.size(); i++) {
        const placed = mesh.geometries.get(i);
        const geometry = api.GetGeometry(modelId, placed.geometryExpressID);
        try {
          // web-ifc interleaves position and normal: six floats per vertex.
          const raw = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
          const indices = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
          const local = new Float32Array((raw.length / 6) * 3);
          for (let v = 0, o = 0; v + 5 < raw.length; v += 6, o += 3) {
            local[o] = raw[v]!;
            local[o + 1] = raw[v + 1]!;
            local[o + 2] = raw[v + 2]!;
          }
          const positions = transformPositions(local, placed.flatTransformation);
          const b = boundsOf(positions);
          if (!b) continue;
          box = unionBox(box, b);
          const c = placed.color;
          parts.push({
            positions,
            indices: Uint32Array.from(indices),
            color: [c.x, c.y, c.z, c.w],
          });
        } finally {
          geometry.delete();
        }
      }
      if (!box || parts.length === 0) return;
      let guid = '';
      let name = '';
      try {
        const line = api.GetLine(modelId, expressId, false);
        guid = text(line?.GlobalId);
        name = text(line?.Name);
      } catch {
        /* an element without readable attributes is still shown, just not pinnable */
      }
      elements.push({ expressId, guid, name, ifcType, parts, box });
    });
  } finally {
    api.CloseModel(modelId);
  }
  return elements;
}
