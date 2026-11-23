import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
    // 'hidden': maps are generated (server-side, for debugging) but the
    // bundles carry no `sourceMappingURL` comments, so they aren't fetched
    // by browsers.
    sourcemap: 'hidden',
    // No forced chunking — the workspace editors are lazy-loaded through
    // Shell's `lazy()` calls, so each editor gets its own on-demand chunk.
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
