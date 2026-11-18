// Turns a spoken phrase (already transcribed on the phone) into one hands-free action (mobile F14).
// Pure text in, intent out: no audio, no native modules, so it is the same on iOS, Android and in tests.
// The first words choose the action; everything after is the dictated body. Anything unrecognised is
// `unknown`, never guessed, and no intent submits or sends anything: the screen reads the result back and
// the worker confirms by voice or tap.

export type VoiceIntent =
  | { kind: 'diary.note'; text: string }
  | { kind: 'diary.delay'; description: string; hours: number }
  | { kind: 'rfi.raise'; text: string }
  | { kind: 'incident.report'; text: string }
  | { kind: 'nova.ask'; question: string }
  | { kind: 'confirm' }
  | { kind: 'cancel' }
  | { kind: 'unknown'; heard: string };

const WORD_NUMBERS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  half: 0.5,
  an: 1,
  a: 1,
};

const clean = (s: string) =>
  s
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '');

/** Capitalise the first letter; dictation arrives lower case. */
const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function matchPrefix(text: string, prefixes: RegExp[]): string | null {
  for (const p of prefixes) {
    const m = p.exec(text);
    if (m) return clean(text.slice(m[0].length));
  }
  return null;
}

/** "2 hours", "two hours", "half an hour", "one and a half hours" → hours, in quarter hours, as the diary takes them. */
export function spokenHours(s: string): number | null {
  const t = s.toLowerCase();
  if (/half an? hour/.test(t)) return 0.5;
  const m = /(\d+(?:\.\d+)?|[a-z]+)(?: and a half)?\s*(?:hours?|hrs?)\b/.exec(t);
  if (!m) return null;
  const raw = m[1]!;
  const base = /^\d/.test(raw) ? Number(raw) : WORD_NUMBERS[raw];
  if (base === undefined || Number.isNaN(base)) return null;
  const n = base + (/and a half/.test(m[0]) ? 0.5 : 0);
  return n > 0 && n <= 24 ? Math.round(n * 4) / 4 : null;
}

const CONFIRM = /^(yes|yep|yeah|confirm|correct|that'?s right|send it|save it|do it)\b/i;
const CANCEL = /^(no|nope|cancel|stop|scrap that|never ?mind|discard)\b/i;

export function parseVoice(heard: string): VoiceIntent {
  const text = clean(heard);
  const lower = text.toLowerCase();
  if (!lower) return { kind: 'unknown', heard: '' };
  if (CONFIRM.test(lower)) return { kind: 'confirm' };
  if (CANCEL.test(lower)) return { kind: 'cancel' };

  const nova = matchPrefix(text, [
    /^(?:hey |ok |okay )?nova[,:]?\s*/i,
    /^ask nova\s*(?:to |about |if |whether )?/i,
  ]);
  if (nova)
    return nova ? { kind: 'nova.ask', question: sentence(nova) } : { kind: 'unknown', heard: text };

  const delay = matchPrefix(text, [
    /^(?:log|add|record|note) (?:a )?delay[,:]?\s*(?:for |due to )?/i,
  ]);
  if (delay !== null) {
    const hours = spokenHours(delay);
    const description = clean(
      delay
        .replace(/\b(?:for )?(?:\d+(?:\.\d+)?|[a-z]+)(?: and a half)?\s*(?:hours?|hrs?)\b/i, '')
        .replace(/half an? hour/i, ''),
    );
    return hours && description
      ? { kind: 'diary.delay', description: sentence(description), hours }
      : { kind: 'unknown', heard: text };
  }

  const incident = matchPrefix(text, [
    /^(?:report|log|raise|record) (?:an? )?(?:incident|near miss|injury)[,:]?\s*/i,
    /^(?:incident|near miss)[,:]\s*/i,
  ]);
  if (incident) return { kind: 'incident.report', text: sentence(incident) };

  const rfi = matchPrefix(text, [
    /^(?:raise|log|start|create|new) (?:an? )?rfi[,:]?\s*(?:about |for |on )?/i,
    /^rfi[,:]\s*/i,
  ]);
  if (rfi) return { kind: 'rfi.raise', text: sentence(rfi) };

  const note = matchPrefix(text, [
    /^(?:diary|site diary)(?: note| entry)?[,:]?\s*/i,
    /^(?:add|write|make|log) (?:a )?(?:diary )?(?:note|entry)(?: to (?:the )?(?:site )?diary)?[,:]?\s*/i,
    /^add to (?:the )?(?:site )?diary[,:]?\s*/i,
  ]);
  if (note) return { kind: 'diary.note', text: sentence(note) };

  return { kind: 'unknown', heard: text };
}

/** The line read back to the worker before anything is saved. */
export function readBack(intent: VoiceIntent): string {
  switch (intent.kind) {
    case 'diary.note':
      return `Add to today's diary: ${intent.text}. Say yes to save or cancel.`;
    case 'diary.delay':
      return `Log a ${intent.hours} hour delay: ${intent.description}. Say yes to save or cancel.`;
    case 'rfi.raise':
      return `Start an RFI: ${intent.text}. Say yes to open the draft or cancel.`;
    case 'incident.report':
      return `Start an incident report: ${intent.text}. Say yes to open it or cancel.`;
    case 'nova.ask':
      return `Ask Nova: ${intent.question}`;
    default:
      return "Sorry, I didn't catch that. Try diary note, log delay, raise RFI, report incident, or ask Nova.";
  }
}
