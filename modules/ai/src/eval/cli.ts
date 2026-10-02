// pnpm --filter @archova/mod-ai eval [--task <id>] [--provider fake|bedrock] [--sample <n>] [--out <file.md>]
/* eslint-disable no-console -- command-line output */
// Exits 1 when any suite is below its bars (the CI gate in ai/06 §4).
import { writeFileSync } from 'node:fs';
import type { ModelTier } from '@archova/ai-prompts';
import { buildRoutingTable, FAKE_MODELS } from '../index';
import { createBedrockProvider } from '../infra/providers/bedrock';
import { createFakeProvider } from '../infra/providers/fake';
import { formatReport, runSuite } from './harness';
import { SUITES } from './suites';

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const providerKind = arg('provider') ?? 'fake';
const task = arg('task');
const sample = arg('sample') ? Number(arg('sample')) : undefined;
const suites = task ? SUITES.filter((s) => s.prompt.id === task) : SUITES;
if (task && !suites.length) {
  console.error(`No eval suite for ${task}`);
  process.exit(2);
}

const models: Record<ModelTier, string> =
  providerKind === 'bedrock'
    ? {
        fast: process.env.AI_EVAL_MODEL_FAST ?? '',
        standard: process.env.AI_EVAL_MODEL_STANDARD ?? '',
        advanced: process.env.AI_EVAL_MODEL_ADVANCED ?? '',
      }
    : { ...FAKE_MODELS };
const routing = buildRoutingTable(models);

const reports: string[] = [];
let failed = false;
for (const suite of suites) {
  const provider =
    providerKind === 'bedrock'
      ? createBedrockProvider({ region: process.env.AI_EVAL_REGION ?? 'ap-southeast-2' })
      : createFakeProvider(suite.fake ? { [suite.prompt.id]: suite.fake } : {});
  const report = await runSuite(suite, {
    provider,
    routing,
    gate: providerKind === 'fake' ? 'safety' : 'all',
    ...(sample ? { sample } : {}),
  });
  reports.push(formatReport(report));
  failed ||= !report.passed;
}
const out = reports.join('\n\n') || 'No eval suites registered.';
console.log(out);
const outFile = arg('out');
if (outFile) writeFileSync(outFile, out + '\n');
process.exit(failed ? 1 : 0);
