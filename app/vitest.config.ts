import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Vitest only. The app itself is built and served by Next.js.
export default defineConfig({
  plugins: [react()],
  // `server-only` throws outside a React Server build; tests import server files directly.
  resolve: { alias: { 'server-only': fileURLToPath(new URL('./src/test/empty.ts', import.meta.url)) } },
  test: { include: ['src/**/*.test.{ts,tsx}'] },
})
