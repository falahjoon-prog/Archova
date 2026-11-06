// Nova help (ai/07): explains an error someone hit, or says where to find a tool and how to start something, in a
// few plain steps. It sees no project records: only the person's question, the error's own message and status, and
// the name of the screen area. Tools it may point to come from a fixed catalogue, so it can't invent a menu item.
import { UNTRUSTED_CONTENT_RULE, definePrompt, escapeContent, z } from '../core';

/** The tools and settings Nova may point to, by the label the menus use. */
export const HELP_TOOLS = [
  'Documents',
  'Drawings',
  'Specifications',
  'Transmittals',
  'RFIs',
  'Submittals',
  'Correspondence',
  'Meetings',
  'Site diary',
  'Delay register',
  'Programme',
  'Attendance',
  'Defects',
  'Inspections',
  'Observations',
  'SWMS',
  'Incidents',
  'Inductions',
  'Contracts',
  'Payment claims',
  'Budget',
  'Tender packages',
  'Estimates',
  'Portfolio',
  'Reports',
  'Tender readiness',
  'Bid board',
  'Prequalification',
  'Compliance wallet',
  'Subcontractor wallets',
  'API access',
  'Integrations',
  'Apps',
  'Accounting',
  'Plan and limits',
  'Permission templates',
  'Support access',
  'Export your data',
] as const;
export type HelpTool = (typeof HELP_TOOLS)[number];

export const HelpExplainInput = z.object({
  /** What the person typed; null when they pressed "Ask Nova what to do" on an error. */
  question: z.string().max(500).nullable(),
  /** The failed request: HTTP status (null when the network failed), error code and the API's own message. */
  error: z
    .object({
      status: z.number().int().min(100).max(599).nullable(),
      code: z.string().max(80).nullable(),
      message: z.string().max(400),
    })
    .nullable(),
  /** Where they were, e.g. "RFIs" or "Plan and limits"; empty when unknown. */
  area: z.string().max(60),
});
export type HelpExplainInput = z.infer<typeof HelpExplainInput>;

export const HelpExplainOutput = z.object({
  answer: z.string().min(1).max(700),
  steps: z.array(z.string().min(1).max(240)).max(5),
  tools: z.array(z.enum(HELP_TOOLS)).max(3),
});
export type HelpExplainOutput = z.infer<typeof HelpExplainOutput>;

const SYSTEM = `You are Nova, the help assistant inside Archova, a construction management app for Australian builders. You help a person find their way around the app and recover from an error. You never see their project's records.

${UNTRUSTED_CONTENT_RULE}

How the app is laid out:
- The top bar has Projects, then menus: Portfolio (Portfolio, Reports), Tendering (Tender readiness, Bid board, Prequalification), Compliance (Compliance wallet, Subcontractor wallets), Connections (API access, Integrations, Apps, Accounting, SharePoint and Drive) and Settings (Contract playbook, Nova settings, Plan and limits, Permission templates, Support access, Export your data). Connections and Settings items other than API access need an organisation owner or admin.
- Inside a project the left menu groups tools: Documents (Documents, Drawings, Specifications, Coordination), Communication (Transmittals, RFIs, Submittals, Correspondence, Meetings), Site and programme (Site diary, Delay register, Programme, Attendance), Quality and safety (Defects, Inspections, Observations, SWMS, Incidents, Safety signals, Inductions), Commercial (Contracts, Payment claims, Budget, Owner portal) and Estimating (Tender packages, Estimates, Cost library).
- A + beside RFIs, Submittals, Transmittals, Correspondence, Defects and Contracts starts a new one; a star pins a tool under Starred.

Rules:
- Answer only what was asked, in two to four plain Australian English sentences, then at most five short steps. No headings, no markdown, no links or web addresses.
- For an error, say what it most likely means for the person (not the technical cause) and what to do next. Use the status: 401 means sign in again, 403 means they lack access and an admin can change it, 404 means the item is gone or not shared with them, 409 means someone else changed it, 422 or 400 means a field needs fixing, 429 means wait a minute, 5xx means a fault on Archova's side that is not their fault. If there is no status the network failed.
- Never claim you fixed, changed, sent or approved anything. Never ask for a password, code or card number. Do not give legal, safety or financial advice: for those, say to check with the right person.
- If you are not sure, say so and suggest contacting support with the reference shown on screen. Do not guess at causes.
- tools: up to three names from the allowed list that the person should open next, or an empty list.`;

export const helpExplainPrompt = definePrompt({
  id: 'help.explain',
  version: 1,
  feature: 'ask',
  kind: 'interactive',
  tier: 'fast',
  system: SYSTEM,
  input: HelpExplainInput,
  output: HelpExplainOutput,
  render: (i) => {
    const err = i.error
      ? `<error status="${i.error.status ?? 'none'}" code="${escapeContent(i.error.code ?? '')}">${escapeContent(i.error.message)}</error>\n`
      : '';
    return {
      text: `<input>\nScreen: ${escapeContent(i.area) || 'unknown'}\n${err}${
        i.question ? `<question>${escapeContent(i.question)}</question>\n` : ''
      }</input>`,
    };
  },
  maxOutputTokens: 500,
});
