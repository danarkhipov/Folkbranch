import { describe, expect, it } from 'vitest'
import { ageWords, familyWords, patronymicFrom, peopleWords, splitPatronymic } from '../lib/names'

describe('patronymics', () => {
  it.each([
    ['Иван', 'M', 'Иванович'], ['Иван', 'F', 'Ивановна'], ['Сергей', 'M', 'Сергеевич'], ['Андрей', 'F', 'Андреевна'], ['Игорь', 'M', 'Игоревич'],
    ['Дмитрий', 'M', 'Дмитриевич'], ['Юрий', 'M', 'Юрьевич'], ['Григорий', 'F', 'Григорьевна'], ['Пётр', 'M', 'Петрович'], ['Лев', 'F', 'Львовна'], ['Павел', 'M', 'Павлович'], ['Илья', 'F', 'Ильинична'], ['Никита', 'M', 'Никитич'],
  ] as const)('%s, %s → %s', (name, sex, out) => expect(patronymicFrom(name, sex)).toBe(out))
  it('stays silent when unsure', () => {
    expect(patronymicFrom('Иван', 'U')).toBe('')
    expect(patronymicFrom('John', 'M')).toBe('')
    expect(patronymicFrom('Савва', 'M')).toBe('')
  })
  it('splits only a real patronymic off a given name', () => {
    expect(splitPatronymic('Иван Петрович')).toEqual(['Иван', 'Петрович'])
    expect(splitPatronymic('Анна Мария')).toEqual(['Анна Мария', ''])
    expect(splitPatronymic('Анна')).toEqual(['Анна', ''])
  })
  it('counts years in Russian', () => {
    expect([1, 2, 5, 11, 21, 72, 100].map((n) => ageWords(n, 'ru'))).toEqual(['1 год', '2 года', '5 лет', '11 лет', '21 год', '72 года', '100 лет'])
  })
  it('counts people and families', () => {
    expect([1, 2, 5, 21].map((n) => peopleWords(n, 'ru'))).toEqual(['1 человек', '2 человека', '5 человек', '21 человек'])
    expect([1, 3, 5].map((n) => familyWords(n, 'ru'))).toEqual(['1 семья', '3 семьи', '5 семей'])
    expect(peopleWords(1, 'en')).toBe('1 person')
  })
  it('counts in Spanish and Catalan, one and many', () => {
    expect([1, 2, 0].map((n) => ageWords(n, 'es'))).toEqual(['1 año', '2 años', '0 años'])
    expect([1, 72].map((n) => ageWords(n, 'ca'))).toEqual(['1 any', '72 anys'])
    expect([1, 3].map((n) => peopleWords(n, 'es'))).toEqual(['1 persona', '3 personas'])
    expect([1, 3].map((n) => peopleWords(n, 'ca'))).toEqual(['1 persona', '3 persones'])
    expect([1, 3].map((n) => familyWords(n, 'ca'))).toEqual(['1 família', '3 famílies'])
  })
})
