import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: ['verbose'],
  },
  resolve: {
    alias: {
      // The real `obsidian` package is types-only (main: "").
      // Point all imports to a minimal local stub so instanceof checks work.
      obsidian: fileURLToPath(new URL('./tests/__mocks__/obsidian.ts', import.meta.url)),
    },
  },
});
