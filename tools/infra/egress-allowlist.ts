// Rules for infra/envs/<env>/egress-allowlist.yaml (infrastructure/01 §3.1; X25, X28). The Network Firewall lets
// the restricted subnets (api, ai-worker) reach only these hosts, so this check is what stops an AI endpoint
// outside Australia from ever being allowed.

export interface AllowlistEntry {
  host: string;
  kind: 'ai' | 'integration' | 'platform';
  region?: string;
  owner: string;
  used_by: string;
  reason: string;
}

export interface Allowlist {
  restricted: AllowlistEntry[];
  ai_vendor_denylist: string[];
}

const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const AU_AWS_REGIONS = ['ap-southeast-2', 'ap-southeast-4'];
const AU_AZURE_REGIONS = [
  'australiaeast',
  'australiasoutheast',
  'australiacentral',
  'australiacentral2',
];

// Domains that only ever serve AI. A host under one of these must be an approved, Australian `ai` entry.
const AI_DOMAINS = [
  'openai.com',
  'chatgpt.com',
  'openai.azure.com',
  'cognitiveservices.azure.com',
  'anthropic.com',
  'claude.ai',
  'generativelanguage.googleapis.com',
  'aiplatform.googleapis.com',
  'cohere.com',
  'cohere.ai',
  'mistral.ai',
  'huggingface.co',
  'together.xyz',
  'together.ai',
  'groq.com',
  'perplexity.ai',
  'deepseek.com',
  'x.ai',
  'replicate.com',
  'fireworks.ai',
  'openrouter.ai',
];

// AWS AI services: allowed only through their Sydney or Melbourne endpoints.
const AWS_AI_SERVICES = [
  'bedrock',
  'bedrock-runtime',
  'bedrock-agent',
  'bedrock-agent-runtime',
  'textract',
  'comprehend',
  'rekognition',
  'transcribe',
  'translate',
  'sagemaker',
  'runtime.sagemaker',
  'kendra',
  'q',
];

const under = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

function awsService(host: string): { service: string; region: string | null } | null {
  const m = /^(.+?)(?:\.([a-z]{2}-[a-z]+-\d))?\.amazonaws\.com$/.exec(host);
  if (!m) return null;
  return { service: m[1]!, region: m[2] ?? null };
}

export function isAiHost(host: string): boolean {
  if (AI_DOMAINS.some((d) => under(host, d))) return true;
  const aws = awsService(host);
  return aws !== null && AWS_AI_SERVICES.includes(aws.service);
}

export function checkAllowlist(list: Allowlist): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  if (!Array.isArray(list?.restricted)) return ['`restricted` must be a list'];
  if (!Array.isArray(list.ai_vendor_denylist)) return ['`ai_vendor_denylist` must be a list'];

  for (const [i, e] of list.restricted.entries()) {
    const at = `restricted[${i}] ${e?.host ?? '(no host)'}`;
    for (const field of ['host', 'kind', 'owner', 'used_by', 'reason'] as const) {
      if (typeof e?.[field] !== 'string' || !e[field].trim())
        errors.push(`${at}: \`${field}\` is required`);
    }
    if (typeof e?.host !== 'string') continue;
    const host = e.host;

    if (!HOSTNAME.test(host)) {
      errors.push(
        `${at}: must be an exact lower-case hostname (no wildcards, schemes, ports or paths)`,
      );
      continue;
    }
    if (seen.has(host)) errors.push(`${at}: listed twice`);
    seen.add(host);

    if (!['ai', 'integration', 'platform'].includes(e.kind)) {
      errors.push(`${at}: kind must be ai, integration or platform`);
    }

    const aws = awsService(host);
    if (aws?.region && !AU_AWS_REGIONS.includes(aws.region)) {
      errors.push(
        `${at}: AWS endpoints must be in ap-southeast-2 or ap-southeast-4, not ${aws.region}`,
      );
    }
    if (aws && !aws.region) {
      errors.push(
        `${at}: global AWS endpoints are not allowed; use the regional Sydney or Melbourne endpoint`,
      );
    }

    const ai = isAiHost(host);
    if (ai && e.kind !== 'ai') errors.push(`${at}: this is an AI endpoint, so kind must be ai`);
    if (e.kind === 'ai') {
      if (!e.region) errors.push(`${at}: AI entries must name the Australian region they run in`);
      else if (aws && aws.region !== e.region) {
        errors.push(`${at}: region ${e.region} does not match the endpoint's region ${aws.region}`);
      } else if (under(host, 'openai.azure.com') || under(host, 'cognitiveservices.azure.com')) {
        if (!AU_AZURE_REGIONS.includes(e.region)) {
          errors.push(`${at}: Azure resources must be in an Australian region, not ${e.region}`);
        }
        if (host.split('.').length !== 4)
          errors.push(`${at}: name exactly one Azure resource host`);
      } else if (!aws) {
        errors.push(
          `${at}: not an approved Australian AI endpoint (AWS in Sydney or Melbourne, or Azure in Australia)`,
        );
      }
    }
  }

  for (const d of list.ai_vendor_denylist) {
    if (typeof d !== 'string' || !HOSTNAME.test(d))
      errors.push(`ai_vendor_denylist: ${String(d)} is not a domain`);
  }
  for (const domain of AI_DOMAINS) {
    if (!list.ai_vendor_denylist.some((d) => under(domain, d))) {
      errors.push(`ai_vendor_denylist: must cover ${domain}`);
    }
  }

  return errors;
}
