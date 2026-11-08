import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..')
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []))

// Server-rendered text must not depend on the runtime's default locale, or the browser's first render differs from the server HTML.
it('passes an explicit locale to every toLocale*String call', () => {
  const offenders = files(SRC).flatMap((f) =>
    readFileSync(f, 'utf8')
      .split('\n')
      .flatMap((line, i) => (/\.toLocale(Date|Time)?String\((\)|undefined)/.test(line) ? [`${f.slice(SRC.length + 1)}:${i + 1}`] : [])),
  )
  expect(offenders).toEqual([])
})
