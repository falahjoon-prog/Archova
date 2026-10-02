// Metro for a pnpm workspace (docs/mobile/05 §5.1). Shared @archova/* packages export TypeScript source
// (`exports: { '.': './src/index.ts' }`), so Metro must watch the repo root and honour package exports.
// expo/metro-config already detects monorepos; the explicit settings below keep the behaviour stable.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
