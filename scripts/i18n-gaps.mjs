// What Spanish and Catalan do not have yet. Never fails: English stands in for every gap.
//   pnpm i18n:gaps          how many words each language lacks, and the first few
//   pnpm i18n:gaps es       every word Spanish lacks: the Russian key, then the English
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { gaps, pairs, wanted } from './i18n-words.ts'

async function main() {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
  const { english } = await import(pathToFileURL(path.join(root, 'lib/i18n.ts')).href)
  const all = wanted(english, pairs(root))
  const only = process.argv[2]
  for (const lang of ['es', 'ca']) {
    if (only && only !== lang) continue
    const table = (await import(pathToFileURL(path.join(root, `lib/i18n-${lang}.ts`)).href)).default
    const missing = gaps(all, table)
    console.log(`${lang}: ${all.size - missing.length} of ${all.size} words, ${missing.length} missing (they show in English)`)
    for (const ru of only ? missing : missing.slice(0, 5)) console.log(`  ${JSON.stringify(ru)}  →  ${JSON.stringify(all.get(ru))}`)
    if (!only && missing.length > 5) console.log(`  … pnpm i18n:gaps ${lang} lists all of them`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
