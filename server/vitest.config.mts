import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

// SWC emits the decorator metadata NestJS needs for dependency injection.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: { include: ['test/**/*.spec.ts', 'src/**/*.spec.ts'], environment: 'node' },
})
