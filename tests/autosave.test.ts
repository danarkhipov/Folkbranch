import { describe, expect, it, vi } from 'vitest'
import { autosave, clearDraft, loadDraft, type SaveStatus } from '../lib/autosave'

function setup() {
  const data = new Map<string, string>()
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) }
  let text = 'a'
  const sent: { text: string; base: number | null }[] = []
  const send = vi.fn(async (t: { content: unknown }, base: number | null) => { sent.push({ text: t.content as string, base }); return (base ?? 100) + 1 })
  const statuses: SaveStatus[] = []
  const s = autosave({ id: 'p', base: 1, read: () => ({ title: 'T', content: text }), send, onStatus: (x) => statuses.push(x), store, delay: 10, retry: 20 })
  return { s, send, sent, statuses, store, type: (v: string) => { text = v; s.change() } }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('autosave', () => {
  it('saves after a pause, once, and clears the kept text', async () => {
    const { s, send, type, store, statuses } = setup()
    type('b'); type('c')
    expect(send).not.toHaveBeenCalled()
    await wait(30)
    expect(send).toHaveBeenCalledTimes(1)
    expect(loadDraft('p', store)).toBeNull()
    expect(statuses).toEqual(['saved'])
    s.close()
  })

  it('keeps the text and tries again while the server is away, and each save builds on the last', async () => {
    const { s, send, type, store, statuses, sent } = setup()
    send.mockRejectedValueOnce(new TypeError('failed to fetch'))
    type('offline')
    await wait(15)
    expect(statuses.at(-1)).toBe('waiting')
    expect(loadDraft('p', store)?.content).toBe('offline')
    expect(s.unsent()).toBe(true)
    await wait(40)
    expect(statuses.at(-1)).toBe('saved')
    expect(loadDraft('p', store)).toBeNull()
    type('next')
    await wait(30)
    expect(sent.at(-1)).toEqual({ text: 'next', base: 2 })
    s.close()
  })

  it('never runs two saves at once, so an older one cannot land last', async () => {
    const { s, send, type, sent } = setup()
    let release = () => {}
    send.mockImplementationOnce(async (t) => { await new Promise<void>((r) => { release = r }); sent.push({ text: t.content as string, base: 1 }); return 2 })
    type('first')
    await wait(15)
    type('second')
    await wait(30)
    expect(send).toHaveBeenCalledTimes(1)
    release()
    await wait(30)
    expect(sent.map((x) => x.text)).toEqual(['first', 'second'])
    s.close()
  })

  it('stops on a conflict until the person chooses, keeping their text', async () => {
    const { s, send, type, store, statuses, sent } = setup()
    send.mockRejectedValueOnce(Object.assign(new Error('changed'), { status: 409 }))
    type('mine')
    await wait(50)
    expect(statuses.at(-1)).toBe('conflict')
    expect(send).toHaveBeenCalledTimes(1)
    type('more')
    await wait(50)
    expect(send).toHaveBeenCalledTimes(1)
    expect(loadDraft('p', store)?.content).toBe('mine')
    s.overwrite()
    await wait(10)
    expect(sent.at(-1)).toEqual({ text: 'more', base: null })
    expect(statuses.at(-1)).toBe('saved')
    s.close()
  })

  it('dropping the text on a conflict forgets it', async () => {
    const { s, send, type, store } = setup()
    send.mockRejectedValueOnce(Object.assign(new Error('changed'), { status: 409 }))
    type('mine')
    await wait(30)
    s.discard()
    expect(loadDraft('p', store)).toBeNull()
    expect(s.hide()).toBeNull()
    s.close()
  })

  it('a closing tab leaves the text in the browser', () => {
    const { s, type, store } = setup()
    type('last words')
    expect(s.hide()).toMatchObject({ content: 'last words', base: 1 })
    expect(loadDraft('p', store)?.content).toBe('last words')
    s.close()
  })

  it('a full browser store does not stop saving', async () => {
    const { s, type, store, send } = setup()
    store.setItem = () => { throw new Error('quota') }
    type('x')
    await wait(30)
    expect(send).toHaveBeenCalled()
    clearDraft('p', store)
    s.close()
  })
})
