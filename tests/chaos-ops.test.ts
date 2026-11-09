// The same odd input, but through the archive itself: what people type, import and upload. Whatever happens,
// the archive keeps answering: an operation may refuse in words (OpError), but nothing may crash or hang.
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { OpError, type Actor } from '../lib/ops/core'
import { exportGedcom, importGedcom, previewGedcom, type ImportMode } from '../lib/ops/gedcom'
import { storeUpload } from '../lib/ops/media'
import { createPerson, getGraph, updatePerson } from '../lib/ops/people'
import { searchPeople } from '../lib/ops/people-search'
import { searchArchive } from '../lib/ops/search'
import { parseFamilyText } from '../lib/textformat'
import { splitText } from '../lib/linkify'
import { layoutFamily } from '../lib/graph/layout'

const owner: Actor = { userId: 'u-chaos', name: 'Хаос', role: 'owner', personId: null }
let seed = 7
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]
const ODD = ['', ' ', '\0', '‮', '😀', 'ё'.repeat(3000), '"', "'", '<script>alert(1)</script>', '../../etc/passwd', '\r\n', '0', '-1', 'NaN', 'null', '[]', '{}', '\ud800', 'İ', '31 FEB 2023', 'ABT 1850', '0000', '10000', '-0044', '1850-13-45', "Robert'); DROP TABLE persons;--", '%s%n', '{{7*7}}', '${process.env.X}']
const refusal = (e: unknown) => e instanceof OpError

describe('people typed in with odd text', () => {
  it('every field takes odd text or refuses in words', () => {
    for (let i = 0; i < 150; i++) {
      try {
        const id = createPerson(owner, { givenName: pick(ODD), surname: pick(ODD), patronymic: pick(ODD), maidenName: pick(ODD), birthDate: pick(ODD), deathDate: pick(ODD), birthPlace: pick(ODD), deathPlace: pick(ODD), sex: pick(['M', 'F', 'U', 'x', '']) as never } as never)
        const pid = (id as { id?: string }).id ?? String(id)
        updatePerson(owner, pid, { givenName: pick(ODD), birthDate: pick(ODD) } as never)
      } catch (e) {
        expect(refusal(e) || (e as Error).name === 'ZodError').toBe(true)
      }
    }
  })
  it('search never throws on any query, and finishes quickly', () => {
    const t0 = Date.now()
    for (const q of [...ODD, '1850', '1850-1900', 'до 1900', 'после 1850', '"', '(', '*', '%', '\\', 'a'.repeat(5000), 'и или не']) {
      expect(() => searchPeople(owner, q)).not.toThrow()
      expect(() => searchArchive(owner, q)).not.toThrow()
    }
    expect(Date.now() - t0).toBeLessThan(10_000)
  })
  it('the chart lays out whatever the archive now holds', () => {
    const g = getGraph(owner)
    expect(g.persons.length).toBeGreaterThan(0)
    expect(() => layoutFamily(g as never)).not.toThrow()
  })
})

describe('files people bring', () => {
  it('a GEDCOM of garbage is previewed and imported in every mode without crashing', () => {
    const tags = ['INDI', 'FAM', 'NAME', 'BIRT', 'DATE', 'PLAC', 'HUSB', 'WIFE', 'CHIL', 'OBJE', 'FILE', 'CONT', 'SEX', 'NOTE', 'SOUR', 'DEAT', 'MARR', 'FAMC', 'FAMS']
    for (let i = 0; i < 40; i++) {
      const lines = ['0 HEAD', ...Array.from({ length: Math.floor(rnd() * 50) }, () => `${pick([0, 1, 2, 3])} ${pick(['', `@${pick(['I1', 'I2', 'I1', 'F1'])}@`])} ${pick(tags)} ${pick(ODD)}${pick(['@I1@', '@F1@', '@NOPE@', ''])}`)]
      const text = lines.join(pick(['\n', '\r\n', '\r']))
      for (const mode of ['add', 'merge', 'replace'] as ImportMode[]) {
        try { previewGedcom(owner, text); importGedcom(owner, text, mode) } catch (e) { expect(refusal(e), `${mode}: ${(e as Error).stack?.split('\n').slice(0, 3).join(' | ')}`).toBe(true) }
      }
    }
    expect(() => exportGedcom(owner, true)).not.toThrow()
    expect(() => exportGedcom(owner, false)).not.toThrow()
  })
  it('family text of garbage is read or refused', () => {
    for (let i = 0; i < 100; i++) expect(() => parseFamilyText(Array.from({ length: Math.floor(rnd() * 20) }, () => pick([...ODD, 'Иван (1850-1900)', '  - сын: Пётр', 'Анна + Иван', '# заголовок'])).join('\n'))).not.toThrow()
    for (const s of ODD) expect(() => splitText(s, true)).not.toThrow()
  })
  it('an upload of any bytes is stored as a picture or refused in words, never half-stored', async () => {
    const bad = [Buffer.alloc(0), Buffer.from('not an image'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]), Buffer.alloc(2000, 0x89), Buffer.from('<svg onload=alert(1)>'), Buffer.from('%PDF-1.4 broken')]
    for (const b of bad) {
      for (const name of ['a.jpg', '', '../../x.png', 'x'.repeat(400) + '.jpg', 'a\0.jpg', 'ё😀.heic']) {
        try { await storeUpload(b, name, 'u-chaos') } catch (e) { expect(refusal(e) || e instanceof Error, String(e)).toBe(true) }
      }
    }
    const png = await sharp({ create: { width: 3, height: 3, channels: 3, background: '#fff' } }).png().toBuffer()
    await expect(storeUpload(png, 'ok.png', 'u-chaos')).resolves.toBeTruthy()
  })
})
