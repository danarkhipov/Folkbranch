// The history says what happened in words, including for entries written before it learned to.
import { describe, expect, it } from 'vitest'
import { changeDetails, readableSummary } from '../lib/ops/history-text'

const names = (id: string) => ({ a: 'Анна', b: 'Борис' })[id] ?? 'Без названия'
const relation = { table: 'parentChild', id: 'r', before: { parentId: 'a', childId: 'b', kind: 'birth', certainty: 'family' }, after: { parentId: 'a', childId: 'b', kind: 'adopted', certainty: 'documented' } }

describe('the history in words', () => {
  it('names the people in a changed relation instead of showing raw values', () => {
    expect(readableSummary('Связь: adopted, documented', [relation], names)).toBe('Изменено родство: Анна — Борис')
    expect(readableSummary('Связь: ?', [relation], names)).toBe('Изменено родство: Анна — Борис')
    expect(readableSummary('Связь:', [], names)).toBe('Изменено родство')
  })

  it('reads as what happened, not as a command, in either language of the day', () => {
    expect(readableSummary('Добавить: Тест', [], names)).toBe('Добавлен человек: Тест')
    expect(readableSummary('Add: Test', [], names)).toBe('Добавлен человек: Test')
    expect(readableSummary('Удалить человека: Тест', [], names)).toBe('Удалён человек: Тест')
  })

  it('says what a rollback took back', () => {
    expect(readableSummary('Отменено', [], names, 'Добавлен человек: Тест')).toBe('Отменено: Добавлен человек: Тест')
  })

  it('marks a new link as new', () => {
    expect(readableSummary('Анна — Борис', [{ table: 'unions', id: 'u', before: null, after: { aId: 'a', bId: 'b' } }], names)).toBe('Новая связь: Анна — Борис')
  })

  it('shows before and after for short values, and only names long ones', () => {
    const page = 'длинный текст '.repeat(100)
    const details = changeDetails([{ table: 'persons', id: 'p', before: { birthDate: '1900', birthPlace: page, facts: '[]' }, after: { birthDate: '1901', birthPlace: 'Тула', facts: '["x"]' } }])
    expect(details.find((d) => d.label === 'Рождение')).toEqual({ label: 'Рождение', before: '1900', after: '1901' })
    expect(details.find((d) => d.label === 'Место рождения')!.before!.length).toBeLessThanOrEqual(61)
    expect(details.find((d) => d.label === 'Факты')).toEqual({ label: 'Факты', before: null, after: null })
    expect(changeDetails([relation])[0]).toEqual({ label: 'Родство', before: 'родной, со слов семьи', after: 'приёмный, по документу' })
  })
})
