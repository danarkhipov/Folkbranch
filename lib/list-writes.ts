/**
 * Writes for lists kept whole on one record, such as a person's facts.
 *
 * Leaving a field saves it, and the click that took the focus away writes again right after,
 * before any fetch has brought the first change back. So each change builds on the list as last
 * written, not as last fetched, and the requests go one at a time, in order. A fetch that lands
 * while a write is pending is older than that write, so it is ignored; the fetch that follows the
 * last write brings the final state.
 */
export function listWriter<L extends Record<string, unknown>>(initial: L, send: (patch: Partial<L>) => Promise<unknown>, onError: (e: unknown) => void = () => {}) {
  let lists = initial
  let queue: Promise<unknown> = Promise.resolve()
  let pending = 0
  const write = (patch: Partial<L>) => {
    pending++
    queue = queue.then(() => send(patch)).catch(onError).finally(() => { pending-- })
    return queue
  }
  return {
    get: <K extends keyof L>(key: K) => lists[key],
    /** Takes fresh values from the server. */
    sync: (next: L) => { if (!pending) lists = next },
    write,
    /** Writes several fields at once, some of which may be lists. */
    merge: (patch: Partial<L>) => {
      lists = { ...lists, ...Object.fromEntries(Object.entries(patch).filter(([k]) => k in lists)) }
      return write(patch)
    },
    edit: <K extends keyof L>(key: K, change: (list: L[K]) => L[K]) => {
      lists = { ...lists, [key]: change(lists[key]) }
      return write({ [key]: lists[key] } as unknown as Partial<L>)
    },
  }
}
