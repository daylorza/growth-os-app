import type { NextConfig } from 'next'

const config: NextConfig = {
  // Type-checking runs as its own step (`tsc --noEmit` in `pnpm build`).
  typescript: { ignoreBuildErrors: true },
  poweredByHeader: false,
}

export default config
