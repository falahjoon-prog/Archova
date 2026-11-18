// Tiny IFC4 files for the demo: each element is a box (a rectangular profile extruded), enough to show the model
// viewer and a couple of real clashes. Not a substitute for a real model.

export interface DemoElement {
  /** IFC entity: `IFCWALL`, `IFCSLAB`, `IFCBEAM` or `IFCDUCTSEGMENT`. */
  type: 'IFCWALL' | 'IFCSLAB' | 'IFCBEAM' | 'IFCDUCTSEGMENT';
  /** 22-character IFC GlobalId. */
  guid: string;
  name: string;
  /** Where the extrusion starts, in metres, Z up. */
  at: [number, number, number];
  /** Profile width and depth, in metres. */
  profile: [number, number];
  /** Extrusion length, in metres. */
  length: number;
  /** Extrude along world X (ducts, beams) instead of up. */
  alongX?: boolean;
}

const PREDEFINED: Record<DemoElement['type'], string> = {
  IFCWALL: '.STANDARD.',
  IFCSLAB: '.FLOOR.',
  IFCBEAM: '.BEAM.',
  IFCDUCTSEGMENT: '.RIGIDSEGMENT.',
};
const n = (v: number) => (Number.isInteger(v) ? `${v}.` : String(v));

export function makeIfc(fileName: string, elements: readonly DemoElement[]): Uint8Array {
  const lines = [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');",
    `FILE_NAME('${fileName}','2026-11-05T00:00:00',(''),(''),'','','');`,
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    'DATA;',
    "#1=IFCPERSON($,$,'demo',$,$,$,$,$);",
    "#2=IFCORGANIZATION($,'demo',$,$,$);",
    '#3=IFCPERSONANDORGANIZATION(#1,#2,$);',
    "#4=IFCAPPLICATION(#2,'1','demo','demo');",
    '#5=IFCOWNERHISTORY(#3,#4,$,.ADDED.,$,#3,#4,0);',
    '#6=IFCCARTESIANPOINT((0.,0.,0.));',
    '#7=IFCDIRECTION((0.,0.,1.));',
    '#8=IFCDIRECTION((1.,0.,0.));',
    '#9=IFCAXIS2PLACEMENT3D(#6,#7,#8);',
    "#10=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#9,$);",
    '#11=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);',
    '#12=IFCUNITASSIGNMENT((#11));',
    "#13=IFCPROJECT('0DEMOPROJECT0000000001',#5,'Demo',$,$,$,$,(#10),#12);",
    '#22=IFCAXIS2PLACEMENT2D(#23,$);',
    '#23=IFCCARTESIANPOINT((0.,0.));',
  ];
  let id = 100;
  for (const e of elements) {
    const loc = id++;
    const place = id++;
    const lplace = id++;
    const prof = id++;
    const solid = id++;
    const rep = id++;
    const shape = id++;
    const el = id++;
    // Extruding along X: local Z is world X and local X is world Z, as the web viewer tests do.
    const axes = e.alongX ? '#8,#7' : '#7,#8';
    lines.push(
      `#${loc}=IFCCARTESIANPOINT((${e.at.map(n).join(',')}));`,
      `#${place}=IFCAXIS2PLACEMENT3D(#${loc},${axes});`,
      `#${lplace}=IFCLOCALPLACEMENT($,#${place});`,
      `#${prof}=IFCRECTANGLEPROFILEDEF(.AREA.,$,#22,${n(e.profile[0])},${n(e.profile[1])});`,
      `#${solid}=IFCEXTRUDEDAREASOLID(#${prof},#9,#7,${n(e.length)});`,
      `#${rep}=IFCSHAPEREPRESENTATION(#10,'Body','SweptSolid',(#${solid}));`,
      `#${shape}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${rep}));`,
      `#${el}=${e.type}('${e.guid}',#5,'${e.name}',$,$,#${lplace},#${shape},$,${PREDEFINED[e.type]});`,
    );
  }
  lines.push('ENDSEC;', 'END-ISO-10303-21;', '');
  return new TextEncoder().encode(lines.join('\n'));
}

/** Three small models of one level: walls and slab, a duct run, and a beam. Two clashes between them. */
export const DEMO_MODELS = {
  architectural: makeIfc('architectural.ifc', [
    {
      type: 'IFCWALL',
      guid: '0DEMOARCHWALL000000001',
      name: 'Wall W-01',
      at: [0, 0, 0],
      profile: [8, 0.2],
      length: 3,
    },
    {
      type: 'IFCWALL',
      guid: '0DEMOARCHWALL000000002',
      name: 'Wall W-02',
      at: [0, 6, 0],
      profile: [8, 0.2],
      length: 3,
    },
    {
      type: 'IFCSLAB',
      guid: '0DEMOARCHSLAB000000001',
      name: 'Floor slab L1',
      at: [0, 3, -0.2],
      profile: [8, 6.2],
      length: 0.2,
    },
  ]),
  mechanical: makeIfc('mechanical.ifc', [
    {
      type: 'IFCDUCTSEGMENT',
      guid: '0DEMOMECHDUCT000000001',
      name: 'Supply duct D-01',
      at: [-3, 0, 2.5],
      profile: [0.3, 0.3],
      length: 6,
      alongX: true,
    },
    {
      type: 'IFCDUCTSEGMENT',
      guid: '0DEMOMECHDUCT000000002',
      name: 'Return duct D-02',
      at: [-3, 3, 2.5],
      profile: [0.3, 0.3],
      length: 6,
      alongX: true,
    },
  ]),
  structural: makeIfc('structural.ifc', [
    {
      type: 'IFCBEAM',
      guid: '0DEMOSTRUBEAM000000001',
      name: 'Beam B-12',
      at: [-4, 3, 2.45],
      profile: [0.3, 0.3],
      length: 8,
      alongX: true,
    },
  ]),
};
