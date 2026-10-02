// Workspace dependency rules (repo-structure §5, ADR-0006), checked in CI alongside the ESLint import rules:
//  - frontend apps never depend on backend code (modules, kernel, ai-prompts);
//  - backend code never depends on client packages;
//  - pure shared packages never depend on React, Next.js, React Native, Node-only or database libraries;
//  - no app depends on another app;
//  - no source file reaches outside its own package with a relative import (use the package's public index);
//  - AI vendor SDKs are imported only by the provider adapter in the `ai` module, and no self-hosted model
//    runtime is used anywhere (X25, X26; ai/02 §5).
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

interface Pkg {
  name: string;
  dir: string;
  deps: string[];
}

function workspaces(): Pkg[] {
  const out: Pkg[] = [];
  for (const group of ['apps', 'modules', 'packages']) {
    for (const name of readdirSync(join(ROOT, group))) {
      const dir = join(ROOT, group, name);
      const pj = join(dir, 'package.json');
      if (!existsSync(pj)) continue;
      const json = JSON.parse(readFileSync(pj, 'utf8')) as {
        name: string;
        dependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      out.push({
        name: json.name,
        dir,
        deps: Object.keys({ ...json.dependencies, ...json.peerDependencies }),
      });
    }
  }
  return out;
}

const FRONTEND_APPS = new Set(['@archova/web', '@archova/mobile', '@archova/admin']);
const BACKEND = (p: Pkg) =>
  ['@archova/api', '@archova/worker', '@archova/realtime', '@archova/kernel'].includes(p.name) ||
  p.name.startsWith('@archova/mod-');
const PURE = new Set([
  '@archova/domain',
  '@archova/contracts',
  '@archova/api-client',
  '@archova/query',
  '@archova/routes',
  '@archova/markup',
  '@archova/sync-core',
  '@archova/auth-client',
  '@archova/i18n',
  '@archova/time',
  '@archova/design-tokens',
]);
const BACKEND_ONLY = (d: string) =>
  d === '@archova/kernel' || d.startsWith('@archova/mod-') || d === '@archova/ai-prompts';
const CLIENT_ONLY = new Set([
  '@archova/ui',
  '@archova/ui-native',
  '@archova/api-client',
  '@archova/sync-core',
  '@archova/auth-client',
  '@archova/query',
]);
const IMPURE_LIBS = [
  /^react$/,
  /^react-dom/,
  /^next$/,
  /^react-native/,
  /^expo/,
  /^pg$/,
  /^drizzle-orm/,
  /^ioredis/,
  /^fastify/,
  /^@aws-sdk\//,
];
const APPS = new Set([
  '@archova/web',
  '@archova/mobile',
  '@archova/admin',
  '@archova/api',
  '@archova/worker',
  '@archova/realtime',
  '@archova/docs-site',
]);

// AI services we reach only through the `ai` module's provider adapter (Bedrock AU today).
const AI_VENDOR_SDK =
  /^(openai|@anthropic-ai\/.+|@aws-sdk\/client-(bedrock.*|textract|transcribe.*|comprehend.*|rekognition)|@google\/(generative-ai|genai)|@google-cloud\/(vertexai|aiplatform)|@azure\/openai|@azure-rest\/ai-.+|cohere-ai|@mistralai\/.+|ai|@ai-sdk\/.+|langchain|@langchain\/.+|llamaindex|groq-sdk|together-ai|replicate|@huggingface\/inference)(\/.*)?$/;
// Self-hosted or in-process models are ruled out (john, 2 Oct 2026).
const SELF_HOSTED_MODEL =
  /^(ollama|node-llama-cpp|onnxruntime-(node|web|react-native)|@xenova\/transformers|@huggingface\/transformers|@tensorflow\/tfjs.*|@mlc-ai\/.+)(\/.*)?$/;
const AI_MODULE = '@archova/mod-ai';
const AI_ADAPTER_DIR = join(ROOT, 'modules/ai/src/infra/providers') + '/';

const problems: string[] = [];
const pkgs = workspaces();

for (const p of pkgs) {
  for (const d of p.deps) {
    if (FRONTEND_APPS.has(p.name) && BACKEND_ONLY(d))
      problems.push(`${p.name} must not depend on backend package ${d}`);
    if (BACKEND(p) && CLIENT_ONLY.has(d))
      problems.push(`${p.name} must not depend on client package ${d}`);
    if (PURE.has(p.name) && (IMPURE_LIBS.some((re) => re.test(d)) || BACKEND_ONLY(d))) {
      problems.push(`${p.name} is a pure package and must not depend on ${d}`);
    }
    if (APPS.has(d)) problems.push(`${p.name} must not depend on app ${d}`);
    if (AI_VENDOR_SDK.test(d) && p.name !== AI_MODULE)
      problems.push(`${p.name} must not depend on AI vendor SDK ${d}; use the ai module (X26)`);
    if (SELF_HOSTED_MODEL.test(d))
      problems.push(`${p.name} must not depend on ${d}: no self-hosted models (X26)`);
  }
}

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', 'dist', '.next', '.expo', 'generated', '.turbo'].includes(entry)) continue;
    const path = join(dir, entry);
    const st = statSync(path);
    if (st.isDirectory()) yield* sourceFiles(path);
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) yield path;
  }
}

const IMPORT_RE =
  /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
for (const p of pkgs) {
  for (const file of sourceFiles(p.dir)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2]!;
      if (spec.startsWith('.')) {
        const target = resolve(dirname(file), spec);
        if (!target.startsWith(p.dir + '/') && target !== p.dir) {
          problems.push(
            `${relative(ROOT, file)} imports ${spec}, outside ${p.name}; import the package instead`,
          );
        }
      } else if (AI_VENDOR_SDK.test(spec) && !file.startsWith(AI_ADAPTER_DIR)) {
        problems.push(
          `${relative(ROOT, file)} imports ${spec}; only the ai module's provider adapter (modules/ai/src/infra/providers) may import AI vendor SDKs (X26)`,
        );
      } else if (SELF_HOSTED_MODEL.test(spec)) {
        problems.push(`${relative(ROOT, file)} imports ${spec}: no self-hosted models (X26)`);
      } else if (/^@archova\/mod-[a-z-]+\//.test(spec)) {
        problems.push(
          `${relative(ROOT, file)} imports ${spec}; modules are imported only through their public index`,
        );
      }
    }
  }
}

if (problems.length) {
  console.error(`Boundary check failed:\n${problems.map((x) => `  - ${x}`).join('\n')}`);
  process.exit(1);
}
console.log(`Boundary check passed (${pkgs.length} workspaces).`);
