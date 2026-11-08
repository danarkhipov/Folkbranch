// The build copies every file the server code seems to read. A path into the archive without the ignore
// mark makes it copy the family's database and backups into what gets shipped.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []))

describe('the archive stays out of the build', () => {
  it('every path built on the data folder carries the ignore mark', () => {
    const unmarked = files('lib').flatMap((f) => readFileSync(f, 'utf8').split('\n').map((line, i) => ({ f, i, line })))
      .filter(({ line }) => /path\.(join|resolve)\(\s*(DATA_DIR|MEDIA_DIR|dir\(\)|target)\b/.test(line))
      .map(({ f, i }) => `${f}:${i + 1}`)
    expect(unmarked).toEqual([])
  })
  it('a bundle refuses a build that holds a data folder', () => {
    expect(readFileSync('scripts/make-bundle.mjs', 'utf8')).toContain("path.join(stage, 'data')")
  })
})
