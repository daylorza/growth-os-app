import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Vitest only. The app itself is built and served by Next.js.
export default defineConfig({
  plugins: [react()],
  test: { include: ['src/**/*.test.{ts,tsx}'] },
})
