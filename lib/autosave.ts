/**
 * Keeps typed text safe until the server has it. The latest text is kept in the browser before each
 * send, so a lost connection, a closed tab or a crash costs nothing; saves go one at a time, so an
 * older one cannot land after a newer one; and each names the version it was based on, so a copy
 * that fell behind is stopped rather than written over somebody else's text.
 */
export interface PageText { title: string; content: unknown }
export interface Draft extends PageText { base: number }
export type SaveStatus = '' | 'saved' | 'waiting' | 'failed' | 'conflict'
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const draftKey = (id: string) => `page-draft:${id}`

export function loadDraft(id: string, store: Store = localStorage): Draft | null {
  try {
    const raw = store.getItem(draftKey(id))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function clearDraft(id: string, store: Store = localStorage) {
  try { store.removeItem(draftKey(id)) } catch {}
}

export function autosave(o: {
  id: string
  base: number
  read: () => PageText
  /** Sends the text, on top of `base` or over whatever is there when null. Resolves to the new version. */
  send: (text: PageText, base: number | null) => Promise<number>
  onStatus: (s: SaveStatus) => void
  store?: Store
  delay?: number
  retry?: number
}) {
  const { id, read, send, onStatus, delay = 700, retry = 5000 } = o
  const store = o.store ?? localStorage
  let base = o.base, dirty = false, sending = false, held = false, behind = false, closed = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const keep = () => {
    try { store.setItem(draftKey(id), JSON.stringify({ ...read(), base })) } catch {}
  }
  const later = (ms: number) => {
    clearTimeout(timer)
    if (!closed) timer = setTimeout(run, ms)
  }
  async function run(over = false) {
    clearTimeout(timer)
    if (sending || !dirty || (held && !over)) return
    dirty = false
    sending = true
    keep()
    try {
      base = await send(read(), over ? null : base)
      held = behind = false
      if (!dirty) { clearDraft(id, store); onStatus('saved') }
    } catch (e) {
      dirty = behind = true
      const status = (e as { status?: number }).status
      if (status === 409) { held = true; onStatus('conflict') }
      // A refusal will not change by asking again; the text stays in the browser.
      else if (status && status < 500) { held = true; onStatus('failed') }
      else { onStatus('waiting'); later(retry) }
      return
    } finally {
      sending = false
    }
    // Typed while that save was on its way.
    if (dirty) later(0)
  }

  return {
    change() {
      dirty = true
      if (!held) later(delay)
    },
    /** Tries now, for when the connection comes back. */
    retry: () => { void run() },
    /** Writes this text over the newer one, after the person chose so. */
    overwrite: () => { dirty = true; void run(true) },
    /** Drops this text, after the person chose the newer one. */
    discard() {
      dirty = held = behind = false
      clearTimeout(timer)
      clearDraft(id, store)
    },
    /** The tab is going away: nothing async is promised to finish, so the browser keeps the text. */
    hide() {
      if (dirty) keep()
      return dirty ? { ...read(), base } : null
    },
    /** There is text the server has refused or could not be reached for. */
    unsent: () => dirty && behind,
    close() {
      closed = true
      if (dirty) { keep(); if (!held) void run() }
      clearTimeout(timer)
    },
  }
}
