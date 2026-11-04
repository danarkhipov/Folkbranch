import { describe, expect, it } from 'vitest'
import { accept, addVersion, cardCertainty, editValue, hasConflict, reject, restore, setSource, summary, versions } from '../lib/claims'
import type { Person } from '../lib/types'

const P = (over: Partial<Person> = {}) => ({ claims: [], sources: [{ id: 'm', title: 'Метрика', ref: '', page: '', url: '', reliability: 'original' }, { id: 't', title: 'Тётя', ref: '', page: '', url: '', reliability: 'witness' }, { id: 'g', title: 'Догадка', ref: '', page: '', url: '', reliability: 'guess' }], certainty: 'family', birthDate: '', birthPlace: '', deathDate: '', deathPlace: '', ...over }) as unknown as Person
const on = (p: Person, patch: object) => ({ ...p, ...patch }) as Person

describe('versions of a value', () => {
  it('keeps two answers, and the field stays with the accepted one', () => {
    let p = P({ birthDate: '1923' })
    p = on(p, addVersion(p, 'birthDate', '1925', 'm'))
    expect(p.birthDate).toBe('1923')
    expect(versions(p, 'birthDate').map((c) => [c.value, c.status])).toEqual([['1923', 'accepted'], ['1925', 'possible']])
    expect(hasConflict(p, 'birthDate')).toBe(true)
    const v1925 = versions(p, 'birthDate')[1]
    p = on(p, accept(p, 'birthDate', v1925.id))
    expect(p.birthDate).toBe('1925')
    expect(versions(p, 'birthDate').map((c) => c.status)).toEqual(['accepted', 'possible'])
  })
  it('the first version of an empty field becomes its value', () => {
    let p = P()
    p = on(p, addVersion(p, 'birthPlace', 'Пермь', 't'))
    expect(p.birthPlace).toBe('Пермь')
    expect(versions(p, 'birthPlace')[0].status).toBe('accepted')
  })
  it('a rejected version stays with its reason, and the next takes over', () => {
    let p = P({ birthDate: '1923' })
    p = on(p, addVersion(p, 'birthDate', '1925', 'm'))
    const accepted = versions(p, 'birthDate')[0]
    p = on(p, reject(p, 'birthDate', accepted.id, 'другой человек'))
    expect(p.birthDate).toBe('1925')
    const rejected = versions(p, 'birthDate')[1]
    expect([rejected.value, rejected.status, rejected.reason]).toEqual(['1923', 'rejected', 'другой человек'])
    expect(hasConflict(p, 'birthDate')).toBe(false)
    p = on(p, restore(p, 'birthDate', rejected.id))
    expect(versions(p, 'birthDate')[1].status).toBe('possible')
    expect(p.birthDate).toBe('1925')
  })
  it('rejecting the only version empties the field, restoring brings it back', () => {
    let p = P({ birthDate: '1923' })
    const only = versions(p, 'birthDate')[0]
    p = on(p, reject(p, 'birthDate', only.id, 'опечатка'))
    expect(p.birthDate).toBe('')
    const kept = p.claims[0]
    p = on(p, restore(p, 'birthDate', kept.id))
    expect(p.birthDate).toBe('1923')
  })
  it('the same value from two sources is support, not a conflict', () => {
    let p = P({ birthDate: '1923' })
    p = on(p, addVersion(p, 'birthDate', '1923', 'm'))
    expect(hasConflict(p, 'birthDate')).toBe(false)
  })
  it('typing corrects the accepted version without adding one', () => {
    let p = P({ birthDate: '1923' })
    p = on(p, addVersion(p, 'birthDate', '1925', 'm'))
    p = on(p, editValue(p, 'birthDate', '1924'))
    expect(p.birthDate).toBe('1924')
    expect(versions(p, 'birthDate').map((c) => c.value)).toEqual(['1924', '1925'])
    const plain = P({ birthPlace: 'Пермь' })
    expect(editValue(plain, 'birthPlace', 'Омск').claims).toEqual([])
  })
})

describe('what the card says about itself', () => {
  it('counts per field, each with its own source', () => {
    let p = P({ birthDate: '1923', birthPlace: 'Пермь', deathDate: '1990' })
    p = on(p, setSource(p, 'birthDate', versions(p, 'birthDate')[0].id, 'm'))
    p = on(p, setSource(p, 'birthPlace', versions(p, 'birthPlace')[0].id, 't'))
    expect(summary(p)).toEqual({ documented: 1, told: 1, unsourced: 1, conflict: 0 })
    expect(cardCertainty(p)).toBe('family')
  })
  it('is documented only when every value rests on a document', () => {
    let p = P({ birthDate: '1923' })
    p = on(p, setSource(p, 'birthDate', versions(p, 'birthDate')[0].id, 'm'))
    expect(cardCertainty(p)).toBe('documented')
    p = on(p, addVersion(p, 'birthDate', '1925', 't'))
    expect(cardCertainty(p)).toBe('family')
  })
  it('a second source saying the same thing supports the value', () => {
    let p = P({ birthDate: '1923' })
    p = on(p, setSource(p, 'birthDate', versions(p, 'birthDate')[0].id, 't'))
    expect(summary(p).told).toBe(1)
    p = on(p, addVersion(p, 'birthDate', '1923', 'm'))
    expect(summary(p)).toEqual({ documented: 1, told: 0, unsourced: 0, conflict: 0 })
    expect(cardCertainty(p)).toBe('documented')
  })
  it('a corrected value no longer counts as coming from the source', () => {
    let p = P({ birthDate: '1923' })
    p = on(p, setSource(p, 'birthDate', versions(p, 'birthDate')[0].id, 'm'))
    p = on(p, editValue(p, 'birthDate', '1924'))
    expect(versions(p, 'birthDate')[0].sourceId).toBeNull()
    expect(summary(p).unsourced).toBe(1)
    const same = on(p, setSource(p, 'birthDate', versions(p, 'birthDate')[0].id, 'm'))
    expect(versions(on(same, editValue(same, 'birthDate', '1924')), 'birthDate')[0].sourceId).toBe('m')
  })
  it('a name counts only once it has a version, and its conflict shows', () => {
    let p = P({ surname: 'Соколов' } as Partial<Person>)
    expect(summary(p).unsourced).toBe(0)
    p = on(p, addVersion(p, 'surname', 'Соколовский', 't'))
    expect(p.surname).toBe('Соколов')
    expect(hasConflict(p, 'surname')).toBe(true)
    expect(summary(p)).toEqual({ documented: 0, told: 0, unsourced: 1, conflict: 1 })
  })
  it('a transcription of a document counts as documentary', () => {
    let p = P({ birthDate: '1923' })
    p = { ...p, sources: [{ id: 'r', title: 'Расшифровка', ref: '', page: '', url: '', reliability: 'transcript' }] }
    p = on(p, setSource(p, 'birthDate', versions(p, 'birthDate')[0].id, 'r'))
    expect(summary(p).documented).toBe(1)
  })
  it('a guess marks the card as assumed', () => {
    let p = P({ birthDate: '1923' })
    p = on(p, setSource(p, 'birthDate', versions(p, 'birthDate')[0].id, 'g'))
    expect(cardCertainty(p)).toBe('assumed')
  })
  it('an empty card keeps the mark it has', () => {
    expect(cardCertainty(P({ certainty: 'assumed' }))).toBe('assumed')
  })
})
