import { defineConfig } from 'vitest/config';

// Unit tests for the app's pure logic (config, PKCE flow, secure store adapter). They run in Node without a device or
// simulator; anything that imports react-native stays out of these tests.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
