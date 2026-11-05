/**
 * Tells open pages that the archive changed and who else is here. One process serves everyone, so a
 * plain list is enough. Messages carry no names of relatives: each page fetches what it may see by itself.
 */
export interface LiveClient {
  id: string
  userId: string
  name: string
  focusId: string | null
  /** Whether this client may know that someone looks at a card. */
  canSee: (personId: string) => boolean
  send: (text: string) => void
  close: () => void
}

const MAX_CLIENTS = 300
const PING_MS = 25_000
const CHANGE_MS = 400
const PRESENCE_MS = 200

const hub = ((globalThis as unknown as { __familyLive?: { clients: Set<LiveClient>; ping?: NodeJS.Timeout; change?: NodeJS.Timeout; presence?: NodeJS.Timeout } }).__familyLive ??= { clients: new Set() })

const message = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

function sendAll(text: (c: LiveClient) => string) {
  for (const c of hub.clients) {
    try {
      c.send(text(c))
    } catch {
      leave(c)
    }
  }
}

/** Later, and once: after a restart every page comes back within seconds, and each arrival concerns all the others. */
function sendPresence() {
  if (!hub.clients.size || hub.presence) return
  hub.presence = setTimeout(() => {
    hub.presence = undefined
    const forUser = new Map<string, string>()
    sendAll((c) => {
      const ready = forUser.get(c.userId)
      if (ready) return ready
      const people = new Map<string, { id: string; name: string; focusId: string | null }>()
      for (const o of hub.clients) {
        if (o.userId === c.userId) continue
        const seen = o.focusId && c.canSee(o.focusId) ? o.focusId : null
        if (!people.has(o.userId) || seen) people.set(o.userId, { id: o.userId, name: o.name, focusId: seen })
      }
      const text = message('presence', [...people.values()])
      forUser.set(c.userId, text)
      return text
    })
  }, PRESENCE_MS).unref()
}

export const isFull = () => hub.clients.size >= MAX_CLIENTS

export function join(client: LiveClient) {
  hub.clients.add(client)
  hub.ping ??= setInterval(() => sendAll(() => message('ping', {})), PING_MS).unref()
  client.send(message('hello', { id: client.id }))
  sendPresence()
}

export function leave(client: LiveClient) {
  if (!hub.clients.delete(client)) return
  client.close()
  if (!hub.clients.size && hub.ping) {
    clearInterval(hub.ping)
    hub.ping = undefined
  }
  sendPresence()
}

export function setFocus(userId: string, clientId: string, focusId: string | null) {
  for (const c of hub.clients) if (c.id === clientId && c.userId === userId && c.focusId !== focusId) {
    c.focusId = focusId
    sendPresence()
  }
}

/** After a commit. A burst of writes, such as an import, reaches the pages as one message. */
export function announceChange() {
  if (!hub.clients.size || hub.change) return
  hub.change = setTimeout(() => {
    hub.change = undefined
    sendAll(() => message('change', {}))
  }, CHANGE_MS).unref()
}
