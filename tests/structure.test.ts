// Rules that keep the code easy to extend. Each one guards against a mistake that is easy to make and hard to notice.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { getTableColumns } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { REFERENCES, TRACKED } from '../lib/ops/core'

const sourceFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name)
  return e.isDirectory() ? sourceFiles(p) : /\.tsx?$/.test(e.name) ? [p] : []
})

describe('references between tables', () => {
  it('every column that names a person or a photo is known to the cleanup', () => {
    const declared = new Set(REFERENCES.map((r) => `${r.table}.${r.column}`))
    const allowed = new Set(['persons.avatarMediaId', 'media.uploadedBy', 'pages.parentPageId'])
    for (const [table, def] of Object.entries(TRACKED)) {
      for (const column of Object.keys(getTableColumns(def))) {
        if (!/(person|media|parent|child)Id$|^[ab]Id$/i.test(column)) continue
        const name = `${table}.${column}`
        expect(declared.has(name) || allowed.has(name), `${name} is missing from REFERENCES in lib/ops/core.ts`).toBe(true)
      }
    }
  })
})

describe('translations', () => {
  const dict = readFileSync('lib/i18n.ts', 'utf8')
  const has = (key: string) => dict.includes(`'${key}':`) || dict.includes(`"${key}":`)

  it('every text on screen has an English version', () => {
    const missing = new Set<string>()
    for (const f of [...sourceFiles('components'), ...sourceFiles('app')]) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\bt\('([^']*[а-яё][^']*)'\)/gi)) if (!has(m[1])) missing.add(m[1])
    }
    expect([...missing]).toEqual([])
  })

  it('no text is listed twice', () => {
    const keys = [...dict.matchAll(/'((?:[^'\\\n]|\\.)*[а-яё](?:[^'\\\n]|\\.)*)':/gi)].map((m) => m[1])
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([])
  })
})

describe('database changes', () => {
  it('a mark on a photo survives the change that lets marks have no card', () => {
    const sql = (name: string) => readFileSync(path.join('drizzle', name), 'utf8').split('--> statement-breakpoint')
    const names = readdirSync('drizzle').filter((f) => f.endsWith('.sql')).sort()
    const at = names.findIndex((n) => n.startsWith('0008'))
    const db = new Database(':memory:')
    for (const n of names.slice(0, at)) for (const s of sql(n)) db.exec(s)
    db.prepare("insert into media_tags (id, media_id, person_id, x, y, w, h) values ('t', 'm', 'p', 0.1, 0.2, 0.3, 0.4)").run()
    for (const s of sql(names[at])) db.exec(s)
    expect(db.prepare('select * from media_tags').all()).toEqual([{ id: 't', media_id: 'm', person_id: 'p', label: null, x: 0.1, y: 0.2, w: 0.3, h: 0.4 }])
    db.prepare("insert into media_tags (id, media_id, label) values ('u', 'm', 'Сосед')").run()
  })
})
