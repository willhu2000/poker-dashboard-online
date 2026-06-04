/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Stamp this run's test report with a filesystem-safe timestamp, e.g.
// 2026-06-01T14-22-05, so each run produces an identifiable results file.
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

const entry = (name) => fileURLToPath(new URL(`./${name}`, import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Two HTML entry points: the app, plus a dev fixture dashboard.
    rollupOptions: {
      input: { main: entry('index.html'), fixtures: entry('fixtures.html') },
    },
  },
  test: {
    // Console output as usual, plus a dated JSON report under test-results/.
    reporters: ['default', 'json'],
    outputFile: { json: `./test-results/results-${stamp}.json` },
  },
})
