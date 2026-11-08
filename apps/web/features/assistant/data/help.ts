// Help answers for Ask Nova that need no project records: where a tool lives, and what to do about an error.
// Rule-based and local, so nothing about the person's error leaves the browser; the model-backed version comes
// through the ai module (AU-only, X25) once `ai/help` is in the contract.

import type { ErrorView } from '@/shared/lib/errors';
import type { NovaAnswer } from './preview-answers';

const say = (text: string): NovaAnswer => ({ kind: 'answer', text, citations: [], runId: null });

/** Where each tool lives and how to start a new item, in the words the menus use. */
const TOOLS: ReadonlyArray<{ match: RegExp; text: string }> = [
  {
    match: /\brfis?\b/,
    text: 'RFIs are in the project menu under Communication. Use the + beside RFIs to start a new one.',
  },
  {
    match: /\bsubmittals?\b/,
    text: 'Submittals are in the project menu under Communication. Use the + beside Submittals to start one.',
  },
  {
    match: /\btransmittals?\b/,
    text: 'Transmittals are in the project menu under Communication, with a + for a new one.',
  },
  {
    match: /\bcorrespondence|letters?\b/,
    text: 'Correspondence is in the project menu under Communication, with a + for a new letter.',
  },
  {
    match: /\bdefects?\b/,
    text: 'Defects are in the project menu under Quality & safety. Use the + beside Defects to log one.',
  },
  {
    match: /\bcontracts?\b|payment claims?|\bbudget\b|variations?/,
    text: 'Contracts, Payment claims and Budget are in the project menu under Commercial.',
  },
  {
    match: /\bdrawings?\b|\bspecs?\b|specifications?|\bdocuments?\b/,
    text: 'Documents, Drawings and Specifications are in the project menu under Documents.',
  },
  {
    match: /\bdiary\b|programme|schedule|attendance|delays?/,
    text: 'Site diary, Delay register, Programme and Attendance are in the project menu under Site & programme.',
  },
  {
    match: /inspections?|observations?|swms|toolbox|incidents?|inductions?|safety/,
    text: 'Inspections, Observations, SWMS, Toolbox talks, Incidents and Inductions are in the project menu under Quality & safety.',
  },
  {
    match: /tender|bid|prequal/,
    text: 'Tender readiness, Bid board and Prequalification are in the top bar under Tendering.',
  },
  {
    match: /portfolio|reports?/,
    text: 'Portfolio and Reports are in the top bar under Portfolio.',
  },
  {
    match: /plant|crane|excavator|fleet|machine/,
    text: 'Plant and equipment is in the top bar under Operations.',
  },
  {
    match: /wallet|insurance|licen[cs]es?/,
    text: 'Compliance wallet and Subcontractor wallets are in the top bar under Compliance.',
  },
  {
    match: /integrations?|accounting|xero|myob|api\b|apps?\b|sharepoint|drive/,
    text: 'Integrations, Apps, API access, Accounting and SharePoint and Drive are in the top bar under Connections. Some need an owner or admin.',
  },
  {
    match: /\bplan\b|limits?|permissions?|export|support access|nova settings|playbook/,
    text: 'Contract playbook, Nova settings, Plan and limits, Permission templates, Support access and Export your data are in the top bar under Settings. They need an owner or admin.',
  },
];

const FIND = /\b(where|find|how (do|can) i|go to|get to|navigate|menu|add|create|new|start|log)\b/;
const STAR = /\b(star|favou?rite|pin)\b/;

/** Null when the question isn't about finding or starting something. */
export function navHelpAnswer(question: string): NovaAnswer | null {
  const q = question.toLowerCase();
  if (STAR.test(q)) {
    return say(
      'Hover a tool in the project menu and select its star to pin it under Starred. Select the star again to unpin it.',
    );
  }
  if (!FIND.test(q)) return null;
  const hit = TOOLS.find((t) => t.match.test(q));
  return hit ? say(hit.text) : null;
}

/** What went wrong in plain words, then what to do next. Never repeats anything beyond the error's own message. */
export function errorHelpAnswer(error: ErrorView): NovaAnswer {
  const ref = error.traceId
    ? ` If it keeps happening, send support this reference: ${error.traceId}.`
    : '';
  const s = error.status;
  let text: string;
  if (s === null) {
    text =
      "Your browser couldn't reach Archova. Check your connection, then try again. If other sites work, the service may be briefly unavailable, so wait a minute and retry.";
  } else if (s === 401) {
    text =
      'Your sign-in has expired. Sign in again and repeat what you were doing; nothing was lost on this screen.';
  } else if (s === 403) {
    text =
      "You don't have access to do this. Ask a project admin to raise your level for this tool (Project settings, then Permissions), or ask an owner if it's an organisation setting.";
  } else if (s === 404) {
    text =
      'That item or page no longer exists, or you no longer have access to it. Go back to the list and open it from there; it may have been deleted or moved to another project.';
  } else if (s === 409) {
    text =
      'Someone else changed this at the same time. Reload the page to see their change, then redo yours.';
  } else if (s === 413) {
    text = 'The file is too large. Reduce its size or split it, then upload again.';
  } else if (s === 422 || s === 400) {
    const fields = Object.entries(error.fieldErrors);
    text = fields.length
      ? `Check these fields and try again: ${fields.map(([f, m]) => `${f} (${m})`).join('; ')}.`
      : `The form has something Archova couldn't accept: "${error.message}". Check the highlighted fields and try again.`;
  } else if (s === 429) {
    text = "You've sent a lot of requests quickly. Wait a minute, then try again.";
  } else if (s >= 500) {
    text =
      "That's a problem on Archova's side, not yours. Try again in a minute; your data wasn't changed by a failed request.";
  } else {
    text = `Archova reported: "${error.message}". Try again, and if it repeats, contact support.`;
  }
  return say(`${text}${ref}`);
}
