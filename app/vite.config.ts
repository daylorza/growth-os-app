import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { sep } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

/** With VITE_IGNORE_PRIVATE=1, private/ files are stubbed at build time so they can never reach a bundle. */
const ignorePrivate = (): Plugin => ({
  name: 'ignore-private',
  enforce: 'pre',
  load(id) {
    const file = id.split('?')[0]
    if (process.env.VITE_IGNORE_PRIVATE === '1' && file.includes(`${sep}private${sep}`)) return file.endsWith('.json') ? 'null' : 'export default undefined'
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [ignorePrivate(), react(), tailwindcss()],
  // The master agent prompt lives one level up, next to the brief package.
  server: { fs: { allow: ['..'] } },
})
