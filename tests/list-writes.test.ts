import { describe, expect, it } from 'vitest'
import { listWriter } from '../lib/list-writes'

const server = () => {
  const saved: { facts: string[] }[] = []
  return { saved, send: async (p: { facts?: string[] }) => { await new Promise((r) => setTimeout(r, 5)); saved.push({ facts: p.facts! }) } }
}

describe('listWriter', () => {
  it('keeps text saved on blur when a click adds a row right after', async () => {
    const s = server()
    const w = listWriter({ facts: ['Профессия'] }, s.send)
    w.edit('facts', (l) => l.map(() => 'Профессия: Инженер'))
    await w.edit('facts', (l) => [...l, 'Награда'])
    expect(s.saved.at(-1)!.facts).toEqual(['Профессия: Инженер', 'Награда'])
  })
  it('sends in order, even when the first request is slower', async () => {
    const order: string[] = []
    const w = listWriter({ facts: [] as string[] }, async (p) => {
      await new Promise((r) => setTimeout(r, p.facts![0] === 'first' ? 20 : 1))
      order.push(p.facts![0])
    })
    w.write({ facts: ['first'] })
    await w.write({ facts: ['second'] })
    expect(order).toEqual(['first', 'second'])
  })
  it('goes on after a failed request', async () => {
    const seen: string[][] = []
    let fail = true
    const w = listWriter({ facts: [] as string[] }, async (p) => {
      if (fail) { fail = false; throw new Error('offline') }
      seen.push(p.facts!)
    })
    w.edit('facts', () => ['a'])
    await w.edit('facts', (l) => [...l, 'b'])
    expect(seen).toEqual([['a', 'b']])
  })
  it('takes fresh values from the server', async () => {
    const s = server()
    const w = listWriter({ facts: ['old'] }, s.send)
    w.sync({ facts: ['new'] })
    await w.edit('facts', (l) => [...l, 'x'])
    expect(s.saved[0].facts).toEqual(['new', 'x'])
    expect(w.get('facts')).toEqual(['new', 'x'])
  })
  it('ignores a fetch that lands while a write is pending', async () => {
    const s = server()
    const w = listWriter({ facts: ['Профессия'] }, s.send)
    w.edit('facts', () => ['Профессия: Инженер'])
    w.sync({ facts: ['Профессия'] })
    await w.edit('facts', (l) => [...l, 'Награда'])
    expect(s.saved.at(-1)!.facts).toEqual(['Профессия: Инженер', 'Награда'])
    w.sync({ facts: ['с сервера'] })
    expect(w.get('facts')).toEqual(['с сервера'])
  })
  it('reports a failed write', async () => {
    const errors: unknown[] = []
    const w = listWriter({ facts: [] as string[] }, async () => { throw new Error('offline') }, (e) => errors.push(e))
    await w.edit('facts', () => ['a'])
    expect(errors).toHaveLength(1)
  })
})
