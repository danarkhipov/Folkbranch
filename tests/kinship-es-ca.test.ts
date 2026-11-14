// What Spanish and Catalan must call each relative. Until lib/kinship-es.ts or lib/kinship-ca.ts is filled, that language's
// list is skipped and its archive reads the English terms; once it is filled, every line here must hold.
import { describe, expect, it } from 'vitest'
import { Family, yourTerm } from '../lib/kinship'
import { CA } from '../lib/kinship-ca'
import { ES } from '../lib/kinship-es'
import type { KinWords } from '../lib/kinship-words'
import type { Graph, Person, Sex } from '../lib/types'

/** [up, down, half, man's term, woman's term] */
type Blood = [number, number, boolean, string, string]

const SPANISH: Blood[] = [
  [1, 0, false, 'padre', 'madre'], [2, 0, false, 'abuelo', 'abuela'], [3, 0, false, 'bisabuelo', 'bisabuela'],
  [4, 0, false, 'tatarabuelo', 'tatarabuela'], [5, 0, false, 'cuarto abuelo', 'cuarta abuela'], [6, 0, false, 'quinto abuelo', 'quinta abuela'],
  [11, 0, false, 'décimo abuelo', 'décima abuela'], [12, 0, false, '11.º abuelo', '11.ª abuela'],
  [0, 1, false, 'hijo', 'hija'], [0, 2, false, 'nieto', 'nieta'], [0, 3, false, 'bisnieto', 'bisnieta'], [0, 4, false, 'tataranieto', 'tataranieta'],
  [0, 5, false, 'cuarto nieto', 'cuarta nieta'],
  [1, 1, false, 'hermano', 'hermana'], [1, 1, true, 'medio hermano', 'media hermana'],
  [2, 1, false, 'tío', 'tía'], [3, 1, false, 'tío abuelo', 'tía abuela'], [4, 1, false, 'tío bisabuelo', 'tía bisabuela'],
  [1, 2, false, 'sobrino', 'sobrina'], [1, 3, false, 'sobrino nieto', 'sobrina nieta'], [1, 4, false, 'sobrino bisnieto', 'sobrina bisnieta'],
  [2, 2, false, 'primo hermano', 'prima hermana'], [3, 3, false, 'primo segundo', 'prima segunda'], [4, 4, false, 'primo tercero', 'prima tercera'],
  [3, 2, false, 'tío segundo', 'tía segunda'], [2, 3, false, 'sobrino segundo', 'sobrina segunda'],
  [4, 2, false, 'tío abuelo segundo', 'tía abuela segunda'], [4, 3, false, 'tío tercero', 'tía tercera'],
]
const CATALAN: Blood[] = [
  [1, 0, false, 'pare', 'mare'], [2, 0, false, 'avi', 'àvia'], [3, 0, false, 'besavi', 'besàvia'],
  [4, 0, false, 'rebesavi', 'rebesàvia'], [5, 0, false, 'quadravi', 'quadràvia'], [6, 0, false, 'cinquè avi', 'cinquena àvia'], [12, 0, false, '11è avi', '11a àvia'],
  [0, 1, false, 'fill', 'filla'], [0, 2, false, 'net', 'neta'], [0, 3, false, 'besnet', 'besneta'], [0, 4, false, 'rebesnet', 'rebesneta'], [0, 5, false, 'quadrinet', 'quadrineta'],
  // The DIEC's words: germanastre is first "a sibling through the father or the mother only"; besnebot = renebot.
  [1, 1, false, 'germà', 'germana'], [1, 1, true, 'germanastre', 'germanastra'],
  [2, 1, false, 'oncle', 'tia'], [3, 1, false, 'besoncle', 'bestia'], [4, 1, false, 'rebesoncle', 'rebestia'], [5, 1, false, 'germà del rebesavi', 'germana del rebesavi'],
  [1, 2, false, 'nebot', 'neboda'], [1, 3, false, 'besnebot', 'besneboda'], [1, 4, false, 'rebesnebot', 'rebesneboda'],
  [2, 2, false, 'cosí germà', 'cosina germana'], [3, 3, false, 'cosí segon', 'cosina segona'], [4, 4, false, 'cosí tercer', 'cosina tercera'],
  [3, 2, false, 'oncle segon', 'tia segona'], [2, 3, false, 'nebot segon', 'neboda segona'],
]

function contract(name: string, T: KinWords | null, blood: Blood[], rest: (T: KinWords) => void) {
  describe.runIf(T)(`${name} kinship terms`, () => {
    it.each(blood)('(%i up, %i down, half %s) is %s / %s', (up, down, half, m, f) => {
      expect(T!.blood(up, down, 'M', half)).toBe(m)
      expect(T!.blood(up, down, 'F', half)).toBe(f)
      // Sex unknown: a word or "m/f", never empty.
      expect(T!.blood(up, down, 'U', half)).toMatch(/\p{L}/u)
    })
    it('names the rest', () => rest(T!))
    it('goes on past the table without a gap', () => {
      for (let up = 0; up <= 9; up++) for (let down = 0; down <= 9; down++) if (up || down) for (const s of ['M', 'F', 'U'] as Sex[]) {
        const t = T!.blood(up, down, s, false)
        expect(t, `${up},${down},${s}`).toMatch(/\p{L}/u)
        expect(t, `${up},${down},${s}`).not.toMatch(/undefined|NaN|null|[а-яё]/i)
      }
    })
  })
}

contract('Spanish', ES, SPANISH, (T) => {
  expect([T.adopted('hijo', 'M'), T.adopted('hija', 'F')]).toEqual(['hijo adoptivo', 'hija adoptiva'])
  expect([T.spouse('M'), T.spouse('F')]).toEqual(['esposo', 'esposa'])
  expect([T.stepParent('M'), T.stepParent('F'), T.stepChild('M'), T.stepChild('F')]).toEqual(['padrastro', 'madrastra', 'hijastro', 'hijastra'])
  expect([T.inLawViaSpouse('1,0', 'M', 'F', 'M'), T.inLawViaSpouse('1,0', 'F', 'M', 'F')]).toEqual(['suegro', 'suegra'])
  expect([T.inLawViaSpouse('1,1', 'M', 'F', 'M'), T.inLawViaSpouse('1,1', 'F', 'M', 'F')]).toEqual(['cuñado', 'cuñada'])
  expect([T.inLawOfKin('0,1', 'M'), T.inLawOfKin('0,1', 'F'), T.inLawOfKin('1,1', 'M')]).toEqual(['yerno', 'nuera', 'cuñado'])
  expect([T.spouseKin('primo hermano', 'F'), T.spouseKin('prima hermana', 'M')]).toEqual(['primo hermano de la esposa', 'prima hermana del esposo'])
  expect(T.kinSpouse('prima hermana', 'M', 'F')).toBe('esposo de la prima hermana')
  // The uncle's wife: either way is right in Spain.
  expect(T.kinSpouse('tío', 'F', 'M')).toMatch(/^(esposa del tío|tía política)$/)
  // Off the cousins' generation an in-law is "político", both ways: a spouse's uncle, a nephew's wife.
  expect([T.spouseKin('tío', 'F'), T.kinSpouse('sobrino', 'F', 'M')]).toEqual(['tío político', 'sobrina política'])
  expect([T.your('abuela', 'F'), T.your('bisabuelo', 'M'), T.your('cuarto abuelo', 'M')]).toEqual(['tu abuela', 'tu bisabuelo', 'tu cuarto abuelo'])
  // In a phrase "tu" goes on the relative nearest to the reader.
  expect([T.your('esposo de la prima hermana', 'M'), T.your('primo hermano de la esposa', 'M')]).toEqual(['el esposo de tu prima hermana', 'el primo hermano de tu esposa'])
})

contract('Catalan', CA, CATALAN, (T) => {
  expect([T.adopted('fill', 'M'), T.adopted('filla', 'F')]).toEqual(['fill adoptiu', 'filla adoptiva'])
  expect([T.spouse('M'), T.spouse('F')]).toEqual(['espòs', 'esposa'])
  expect([T.stepParent('M'), T.stepParent('F'), T.stepChild('M'), T.stepChild('F')]).toEqual(['padrastre', 'madrastra', 'fillastre', 'fillastra'])
  expect([T.inLawViaSpouse('1,0', 'M', 'F', 'M'), T.inLawViaSpouse('1,0', 'F', 'M', 'F')]).toEqual(['sogre', 'sogra'])
  expect([T.inLawViaSpouse('1,1', 'M', 'F', 'M'), T.inLawViaSpouse('1,1', 'F', 'M', 'F')]).toEqual(['cunyat', 'cunyada'])
  expect([T.inLawOfKin('0,1', 'M'), T.inLawOfKin('0,1', 'F'), T.inLawOfKin('1,1', 'M')]).toEqual(['gendre', 'nora', 'cunyat'])
  // "de" and "el/la" join a vowel with an apostrophe.
  expect([T.spouseKin('cosí', 'F'), T.spouseKin('cosina', 'M')]).toEqual(["cosí de l'esposa", "cosina de l'espòs"])
  expect([T.kinSpouse('cosina', 'M', 'F'), T.kinSpouse('cosí', 'F', 'M'), T.kinSpouse('oncle', 'F', 'M')]).toEqual(['espòs de la cosina', 'esposa del cosí', "esposa de l'oncle"])
  expect([T.your('àvia', 'F'), T.your('besavi', 'M'), T.your('oncle', 'M')]).toEqual(['la teva àvia', 'el teu besavi', 'el teu oncle'])
  // In a phrase the possessive goes on the relative nearest to the reader.
  expect([T.your("esposa de l'oncle", 'F'), T.your("cosí germà de l'esposa", 'M')]).toEqual(["l'esposa del teu oncle", 'el cosí germà de la teva esposa'])
})

describe('a Spanish or Catalan archive before its terms are filled', () => {
  const graph = {
    persons: [{ id: 'me', sex: 'M' }, { id: 'mum', sex: 'F' }, { id: 'gran', sex: 'F' }] as Person[],
    parentChild: [{ id: '1', parentId: 'mum', childId: 'me', kind: 'birth' }, { id: '2', parentId: 'gran', childId: 'mum', kind: 'birth' }],
    unions: [],
  } as unknown as Graph
  const f = new Family(graph)

  it('names relatives in its own words or in English, never in Russian', () => {
    for (const [lang, T] of [['es', ES], ['ca', CA]] as const) {
      const label = f.relation('me', 'gran', lang)!.label
      expect(label).toBe(T ? T.blood(2, 0, 'F', false) : 'grandmother')
      expect(yourTerm(label, 'F', lang)).not.toMatch(/[а-яё]/i)
    }
  })
})
