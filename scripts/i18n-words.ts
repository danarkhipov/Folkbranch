// The words Spanish and Catalan may translate. Shared by `pnpm i18n:gaps` and tests/i18n-tables.test.ts.
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** Files that keep [Russian, English] pairs beside their code; Spanish and Catalan look the Russian up in their own table too. */
export const PAIR_FILES = ['lib/gedcom.ts', 'lib/agent/labels.ts']

/** The Russian → English pairs in PAIR_FILES, the first English for a Russian word that comes twice. */
export function pairs(root = process.cwd()): Map<string, string> {
  const out = new Map<string, string>()
  for (const f of PAIR_FILES)
    for (const m of readFileSync(path.join(root, f), 'utf8').matchAll(/\['([^'\\\n]*[А-Яа-яЁё][^'\\\n]*)',\s*'([^'\\\n]*)'\]/g)) if (!out.has(m[1])) out.set(m[1], m[2])
  return out
}

/** Every word a language may translate, Russian → English: the English table, then the pairs not already in it. */
export const wanted = (english: Readonly<Record<string, string>>, pairList: Map<string, string>) =>
  new Map<string, string>([...Object.entries(english), ...[...pairList].filter(([ru]) => !(ru in english))])

export const gaps = (all: Map<string, string>, table: Record<string, string>) => [...all.keys()].filter((ru) => !(ru in table))
