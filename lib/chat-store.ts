// The assistant's conversations, kept in this browser for this person: the one open survives a reload, and earlier
// ones can be opened again. They stay on this device only, like an unsent draft; nothing here goes to the server.
import type { UIMessage } from 'ai'

export interface SavedChat { id: string; title: string; at: number; messages: UIMessage[] }

/** How many earlier conversations are kept; the oldest go first. */
const KEEP = 20
const keyOf = (userId: string) => `folkbranch-chats:${userId}`

export function loadChats(userId: string): SavedChat[] {
  try {
    const list = JSON.parse(localStorage.getItem(keyOf(userId)) ?? '[]')
    return Array.isArray(list) ? list.filter((c) => c && typeof c.id === 'string' && Array.isArray(c.messages)) : []
  } catch { return [] }
}

/** A conversation's title: the first thing the person asked, cut short. */
export function chatTitle(messages: UIMessage[]) {
  const first = messages.find((m) => m.role === 'user')?.parts.find((p) => p.type === 'text')
  const text = first && 'text' in first ? first.text.trim().replace(/\s+/g, ' ') : ''
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}

/** Saves a conversation, newest first; an empty one is not kept. A full storage keeps what it had. */
export function saveChat(userId: string, id: string, messages: UIMessage[]) {
  if (!messages.length) return
  const rest = loadChats(userId).filter((c) => c.id !== id)
  const list = [{ id, title: chatTitle(messages), at: Date.now(), messages }, ...rest].slice(0, KEEP)
  try { localStorage.setItem(keyOf(userId), JSON.stringify(list)) } catch {}
}

export function forgetChat(userId: string, id: string) {
  try { localStorage.setItem(keyOf(userId), JSON.stringify(loadChats(userId).filter((c) => c.id !== id))) } catch {}
}
