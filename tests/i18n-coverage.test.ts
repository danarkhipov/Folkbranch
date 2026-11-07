// Every Russian word the app can show has English. A new word without it fails here, before anyone sees it.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { translate } from '../lib/i18n'

// These do not reach a screen as they are: each has its own English path, or is matched against what people typed.
const OWN_ENGLISH = new Set(['lib/i18n.ts', 'lib/demo.ts', 'lib/kinship.ts', 'lib/names.ts', 'lib/agent/labels.ts', 'lib/import-formats.ts', 'lib/search/words.ts', 'lib/search/dates.ts', 'lib/search/engine.ts', 'lib/textformat.ts', 'lib/gedcom.ts', 'lib/markdown.ts', 'lib/ops/registry.ts'])
// The language's own name; a letter folded in searches; a word beside its own English branch in side-panels.tsx.
const NOT_WORDS = new Set(['Русский', 'е', 'для'])
const cyrillic = /[А-Яа-яЁё]/

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) return files(p)
    return /\.tsx?$/.test(name) ? [p] : []
  })
}

/** Plain string literals and JSX text. Template strings are split around ${…}, whose words are caught on their own. */
function literals(source: string) {
  const out: string[] = []
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n').replace(/\s\/\/ .*$/gm, '')
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|>([^<>{}\n]+)</g)) out.push(m[1] ?? m[2] ?? m[3])
  return out.map((s) => s.replace(/\\'/g, "'").trim()).filter((s) => cyrillic.test(s))
}

describe('the English interface', () => {
  const sources = ['app', 'components', 'lib'].flatMap(files).filter((f) => !OWN_ENGLISH.has(f))

  it('looks at the whole app', () => {
    expect(sources.length).toBeGreaterThan(100)
  })

  it('has a translation for every Russian word', () => {
    const missing = sources.flatMap((f) => literals(readFileSync(f, 'utf8'))
      .filter((s) => !NOT_WORDS.has(s) && !s.includes('${') && translate('en', s) === s)
      .map((s) => `${f}: ${s}`))
    expect(missing).toEqual([])
  })

  it('translates into English, not into another Russian word', () => {
    const still = sources.flatMap((f) => literals(readFileSync(f, 'utf8')).filter((s) => !NOT_WORDS.has(s) && !s.includes('${') && translate('en', s) !== s && cyrillic.test(translate('en', s))))
    expect(still).toEqual([])
  })
})
