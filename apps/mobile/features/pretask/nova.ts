// Nova on the pre-task plan: spots hazards the task usually brings that nobody has listed yet. These are plain rules
// over the task description, so they work with no signal. When there is a connection the server's suggestions (hazards
// that keep coming up on this project, the linked SWMS, recent incidents) are added to them.
import type { PretaskHazardInput } from '../../lib/actions/pretask-send';

export interface HazardSuggestion {
  hazard: string;
  controls: string;
  riskBefore: PretaskHazardInput['riskBefore'];
  /** Why Nova raised it, in plain words. */
  because: string;
}

interface Rule {
  /** What in the task description raises it. */
  task: RegExp;
  /** What on the plan already covers it. */
  covered: RegExp;
  suggestion: HazardSuggestion;
}

const RULES: readonly Rule[] = [
  {
    task: /scaffold|roof|ladder|height|edge|facade|formwork|eaves|gutter|void/i,
    covered: /fall|height|edge|ladder|scaffold/i,
    suggestion: {
      hazard: 'Fall from height',
      controls: 'Edge protection or harness anchored, ladder tied off, exclusion zone below.',
      riskBefore: 'high',
      because: 'The task is at height',
    },
  },
  {
    task: /excavat|trench|dig|pit|pothole|footing|service location/i,
    covered: /trench|excavat|collapse|service|underground|dial/i,
    suggestion: {
      hazard: 'Trench collapse or striking underground services',
      controls: 'Dial before you dig, potholing, shoring or battering, spotter, edge barrier.',
      riskBefore: 'high',
      because: 'The task digs',
    },
  },
  {
    task: /crane|lift|hoist|rigging|dogging|truck.?mounted|boom/i,
    covered: /load|crane|lift|rigging|swing|drop/i,
    suggestion: {
      hazard: 'Dropped or swinging load',
      controls: 'Licensed dogger or rigger, exclusion zone, tag lines, load and gear checked.',
      riskBefore: 'high',
      because: 'The task lifts loads',
    },
  },
  {
    task: /weld|grind|torch|hot ?work|cutting|brazing/i,
    covered: /fire|hot ?work|spark|burn/i,
    suggestion: {
      hazard: 'Fire from hot work',
      controls: 'Hot work permit, clear combustibles, fire extinguisher and a fire watch.',
      riskBefore: 'high',
      because: 'The task makes sparks or heat',
    },
  },
  {
    task: /electric|switchboard|cabling|wiring|power|isolat/i,
    covered: /electr|shock|isolat|live|lock/i,
    suggestion: {
      hazard: 'Electric shock',
      controls: 'Isolate, lock out and tag, test before touching, RCDs on leads.',
      riskBefore: 'high',
      because: 'The task works on or near electrical supply',
    },
  },
  {
    task: /concrete|saw|chas|\bcut|pav|drill|core|grind|demolit|tile|masonry|brick/i,
    covered: /silica|dust|resp|mask|wet/i,
    suggestion: {
      hazard: 'Silica dust',
      controls: 'Wet cutting or on-tool extraction, P2 respirator, restrict others from the area.',
      riskBefore: 'high',
      because: 'The task cuts or drills stone, concrete or masonry',
    },
  },
  {
    task: /forklift|delivery|truck|reversing|traffic|crane.?truck|plant|bobcat|loader/i,
    covered: /vehicle|plant|traffic|pedestrian|reversing|forklift|collision/i,
    suggestion: {
      hazard: 'Plant and pedestrian interaction',
      controls: 'Traffic management plan, spotter when reversing, separate walkways, hi-vis.',
      riskBefore: 'high',
      because: 'Vehicles or plant are moving near people',
    },
  },
  {
    task: /confined|tank|manhole|sump|pit|duct|void|shaft/i,
    covered: /confined|atmosphere|gas|oxygen|rescue/i,
    suggestion: {
      hazard: 'Confined space',
      controls: 'Entry permit, atmosphere test, standby person and rescue plan, ventilation.',
      riskBefore: 'extreme',
      because: 'The task goes into an enclosed space',
    },
  },
  {
    task: /asbestos|strip.?out|demolit|ceiling|lagging|fibro|soffit/i,
    covered: /asbestos|acm|fibro/i,
    suggestion: {
      hazard: 'Asbestos disturbed',
      controls:
        'Check the asbestos register first. Stop work and report if suspect material is found.',
      riskBefore: 'high',
      because: 'The task opens up or removes old building fabric',
    },
  },
  {
    task: /paint|spray|solvent|glue|adhesive|epoxy|sealant|chemical|fuel/i,
    covered: /chemical|fume|solvent|vapour|ventilat|sds|flammable/i,
    suggestion: {
      hazard: 'Hazardous chemicals and fumes',
      controls:
        'Read the SDS, ventilate, correct gloves and respirator, keep ignition sources away.',
      riskBefore: 'medium',
      because: 'The task uses chemicals',
    },
  },
  {
    task: /outdoor|external|exterior|roof|slab|pour|landscap|paving|site clear|fence|brick|scaffold|excavat|trench/i,
    covered: /heat|hot|sun|weather|wet|rain|slip|wind|storm|uv/i,
    suggestion: {
      hazard: 'Heat, weather and slippery surfaces',
      controls:
        'Water and shade breaks, sun protection, check the forecast, clear and dry walkways.',
      riskBefore: 'low',
      because: 'Weather can change how the task goes',
    },
  },
];

/** Hazards the task description suggests that no hazard on the plan covers yet. Never repeats one already listed. */
export function missingHazards(
  taskTitle: string,
  hazards: readonly { hazard: string }[],
): HazardSuggestion[] {
  const text = taskTitle.trim();
  if (!text) return [];
  const listed = hazards.map((h) => h.hazard).join(' | ');
  return RULES.filter((r) => r.task.test(text) && !r.covered.test(listed)).map((r) => r.suggestion);
}

/** The server's suggestions first (they come from this project), then the offline rules, once each. */
export function mergeSuggestions(
  fromServer: readonly HazardSuggestion[],
  fromRules: readonly HazardSuggestion[],
  hazards: readonly { hazard: string }[],
): HazardSuggestion[] {
  const seen = new Set(hazards.map((h) => h.hazard.trim().toLowerCase()));
  const out: HazardSuggestion[] = [];
  for (const s of [...fromServer, ...fromRules]) {
    const k = s.hazard.trim().toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}
