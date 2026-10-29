// Bundles the workers with their workspace packages and npm dependencies into dist/ for the container images.
//  - dist/main.js: the relay, dispatcher and scheduled jobs (image `worker`);
//  - dist/ai.js: the ai-worker (image `ai-worker`), which alone loads the modules and so Nova's dependencies.
import { build } from 'esbuild';

await build({
  entryPoints: { main: 'src/main.ts', ai: 'src/ai.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  // Native or file-reading packages stay out of the bundle; only the ai-worker image installs them (Dockerfile).
  external: ['pg-native', '@napi-rs/canvas', 'pdfjs-dist', '@node-rs/argon2'],
  banner: {
    // CommonJS dependencies inside an ESM bundle still call require() for Node built-ins.
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'warning',
});
