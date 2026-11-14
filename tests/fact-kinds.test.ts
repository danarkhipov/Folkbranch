// The role a new participant is offered first, from the kind of event as people write it.
import { describe, expect, it } from 'vitest'
import { firstRole } from '../lib/fact-kinds'

describe('the first role of a participant', () => {
  it('is a godparent at a baptism and a witness at a wedding, in Russian and English', () => {
    expect(['Крещение', 'Baptism', 'Christening'].map((k) => firstRole(k))).toEqual(['Крёстный отец', 'Крёстный отец', 'Крёстный отец'])
    expect(['Брак', 'Венчание', 'Marriage', 'Wedding'].map((k) => firstRole(k))).toEqual(['Свидетель', 'Свидетель', 'Свидетель', 'Свидетель'])
    expect(firstRole('Перепись')).toBe('Участник')
  })

  it('is the same in Spanish and Catalan', () => {
    expect(['Bautismo', 'Bautizo', 'Bateig', 'Baptisme'].map((k) => firstRole(k))).toEqual(Array(4).fill('Крёстный отец'))
    expect(['Matrimonio', 'Boda', 'Casamiento', 'Matrimoni', 'Casament', 'Noces', 'Boda civil'].map((k) => firstRole(k))).toEqual(Array(7).fill('Свидетель'))
    expect(firstRole('Censo')).toBe('Участник')
  })

  it('takes only whole Spanish and Catalan words, so an English kind reads as before', () => {
    expect(['Matrimonial dispute', 'Bodalla', 'Embodament'].map((k) => firstRole(k))).toEqual(Array(3).fill('Участник'))
  })
})
