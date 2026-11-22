import { existsSync, readFileSync } from 'fs'
import path from 'path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// The chronicle's code comes to the map only when a switch under Settings > Map shows it: the map's own imports never
// reach it, and with both switches off the map asks the server for no entry and no shape.
const CHRONICLE = ['components/chronicle-card.tsx', 'components/chronicle-page.tsx', 'components/chronicle-text.tsx', 'components/map-chronicle.ts', 'components/map-chronicle-morph.ts', 'components/map-chronicle-parts.ts']

const resolve = (from: string, spec: string): string | null => {
  const base = spec.startsWith('@/') ? spec.slice(2) : spec.startsWith('.') ? path.join(path.dirname(from), spec) : null
  if (!base) return null
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) if (existsSync(base + ext) && !base.endsWith('/') && /\.tsx?$/.test(base + ext)) return base + ext
  return null
}
const parse = (file: string) => ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

/** Every file a module loads with its first screen: static imports that are not types only, followed through. */
function staticGraph(entry: string): Set<string> {
  const seen = new Set<string>()
  const walk = (file: string) => {
    if (seen.has(file)) return
    seen.add(file)
    for (const st of parse(file).statements) {
      if (!ts.isImportDeclaration(st) && !ts.isExportDeclaration(st)) continue
      if (ts.isImportDeclaration(st) && st.importClause?.isTypeOnly) continue
      if (ts.isExportDeclaration(st) && st.isTypeOnly) continue
      // `import { type A, type B } from`: types only, nothing loaded.
      const named = ts.isImportDeclaration(st) ? st.importClause?.namedBindings : undefined
      if (ts.isImportDeclaration(st) && st.importClause && !st.importClause.name && named && ts.isNamedImports(named) && named.elements.length && named.elements.every((e) => e.isTypeOnly)) continue
      const spec = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : null
      const next = spec && resolve(file, spec)
      if (next) walk(next)
    }
  }
  walk(entry)
  return seen
}

describe('the chronicle on the map, loaded on demand', () => {
  it('none of its code is in what the map loads with its first screen', () => {
    const graph = staticGraph('components/map-view.tsx')
    expect(graph.size).toBeGreaterThan(10)
    expect(CHRONICLE.filter((f) => graph.has(f))).toEqual([])
  })

  it('its code is one dynamic import, made only while a switch is on', () => {
    const src = readFileSync('components/map-view.tsx', 'utf8')
    expect(src.match(/void import\('\.\/map-chronicle-parts'\)/g)).toHaveLength(1)
    expect(src).toMatch(/if \(parts \|\| !\(history \|\| words\)\) return\s+let gone = false\s+void import\('\.\/map-chronicle-parts'\)/)
    // And the parts module holds the canvas, the fronts, the card and the page.
    const parts = staticGraph('components/map-chronicle-parts.ts')
    for (const f of ['components/chronicle-card.tsx', 'components/chronicle-page.tsx', 'components/map-chronicle.ts', 'components/map-chronicle-morph.ts']) expect(parts.has(f), f).toBe(true)
  })

  it('the entries are asked for only with a switch on, and the shapes only with the history on', () => {
    const src = readFileSync('components/map-view.tsx', 'utf8')
    expect(src).toMatch(/useQuery\(\{ queryKey: \['chronicle'\], queryFn: \(\) => api<ChronicleList>\('chronicle'\), enabled: history \|\| words \}\)/)
    expect(src).toMatch(/const entries = \(history \|\| words\) && chronicle\.data\?\.entries \|\| NO_ENTRIES/)
    expect(src).toMatch(/entries\.filter\(\(e\) => history && e\.hasShape\)/)
    // No other way to the list or a shape in the map.
    expect(src.match(/api<[^>]+>\(`?'?chronicle/g)).toHaveLength(3)
  })
})
