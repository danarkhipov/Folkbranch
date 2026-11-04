import { readFileSync } from 'fs'
import { expect, it } from 'vitest'

// A hook after this early return crashed the whole page, and neither types nor unit tests saw it.
it('calls no hooks after the early return of the app shell', () => {
  const source = readFileSync('components/family-app.tsx', 'utf8')
  const start = source.indexOf('if (!ctx) return')
  expect(start).toBeGreaterThan(0)
  const rest = source.slice(start)
  expect(rest.slice(0, rest.indexOf('<App.Provider')).match(/\buse[A-Z]\w*\(/g)).toBeNull()
})
