// Bundles the worker with its workspace packages and npm dependencies into dist/ for the container image
import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
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
