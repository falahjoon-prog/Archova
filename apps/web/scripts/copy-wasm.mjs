// Copies the IFC reader's WebAssembly file next to the app so the browser can fetch it from /wasm/.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const from = createRequire(import.meta.url).resolve('web-ifc/web-ifc.wasm');
mkdirSync('public/wasm', { recursive: true });
copyFileSync(from, 'public/wasm/web-ifc.wasm');
