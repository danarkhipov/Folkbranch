// Ctrl+Z (⌘Z) takes back the person's own last change in the archive, Ctrl+Shift+Z or Ctrl+Y (⌘⇧Z) brings back what was
// last taken back. Inside a text field the keys stay the field's own. Both go through the history, so they are recorded
// like the Undo button and anyone else's later edit is never overwritten.
import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, undoFailure, useApp } from '@/lib/client'
import type { HistoryEntry } from '@/lib/types'

/** Which entry an undo or a redo acts on, from the person's own entries, newest first. Pure, for the tests. */
export function undoTarget(mine: HistoryEntry[], redo: boolean): HistoryEntry | null {
  const byId = new Map(mine.map((e) => [e.id, e]))
  // An entry that undid an ordinary change (not one that undid an undo, which is a redo and counts as a change).
  const isUndo = (e: HistoryEntry) => !!e.undoOf && !byId.get(e.undoOf)?.undoOf
  const live = mine.filter((e) => !e.undoneAt)
  if (!redo) return live.find((e) => !isUndo(e)) ?? null
  // A redo only while nothing new was done after the undo.
  const top = live[0]
  return top && isUndo(top) ? top : null
}

const editable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || !!el.closest?.('[contenteditable="true"], .bn-editor'))
}

/** Renders nothing: listens for the keys while the archive is open. */
export function UndoKeys() {
  const { me, canEdit, notify, t } = useApp()
  const qc = useQueryClient()
  const busy = useRef(false)
  useEffect(() => {
    if (!canEdit || me.guest) return
    const onKey = async (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      const redo = mod && ((key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey && !e.metaKey))
      if (!mod || e.altKey || (!redo && !(key === 'z' && !e.shiftKey)) || editable(e.target) || busy.current) return
      e.preventDefault()
      busy.current = true
      try {
        const list = await api<HistoryEntry[]>('history?limit=100')
        const entry = undoTarget(list.filter((h) => h.userId === me.id), redo)
        if (!entry) { notify(t(redo ? 'Нечего вернуть' : 'Нечего отменить')); return }
        await api(`history/${entry.id}/undo`, { json: {} })
        notify(`${t(redo ? 'Возвращено' : 'Отменено')}: ${entry.summary}`)
        await qc.invalidateQueries()
      } catch (err) {
        notify(undoFailure(err, t))
      } finally {
        busy.current = false
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canEdit, me.guest, me.id, notify, t, qc])
  return null
}
