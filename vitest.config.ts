import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The same "@/" as the app, so components can be rendered in a test.
  resolve: { alias: { '@': path.resolve(__dirname) } },
  test: { setupFiles: ['tests/setup.ts'], exclude: ['**/node_modules/**', '.next/**'] },
})
