// Bundles the API with its workspace packages and npm dependencies into dist/ for the container image
// (infrastructure 03 §2). Native addons stay external and are installed in the image.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: ['@node-rs/argon2', 'pg-native'],
  banner: {
    // CommonJS dependencies inside an ESM bundle still call require() for Node built-ins.
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'warning',
});
