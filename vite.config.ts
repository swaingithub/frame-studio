import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Split the two editors into their own chunks — they're the bulk of
        // the app, and the shell only needs the chunks of the workspace
        // being used.
        manualChunks(id) {
          if (id.includes('/features/video/')) return 'video'
          if (id.includes('/features/photo/')) return 'photo'
          if (id.includes('/features/memes/')) return 'photo'
        },
      },
    },
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
