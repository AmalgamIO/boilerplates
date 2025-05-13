// vitest.config.ts
import { defineConfig } from 'vitest/config'
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      '@app': path.resolve(__dirname, 'src/main')
    }
  },
  test: {
    outputFile: './report/test-report.html',
    alias: {
      '@app': path.resolve(__dirname, 'src/main')
    },
    coverage: {
      cleanOnRerun: true,
      clean: true,

      // reporter: ['text'],
      reportsDirectory: './report', // optional, defaults to './coverage'
      // enabled: true,
      // all: true,

    },
    environment: 'node',
    globals: true,
  }
})