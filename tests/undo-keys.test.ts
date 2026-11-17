import { describe, expect, it } from 'vitest'
import { undoTarget } from '@/components/undo-keys'
import type { HistoryEntry } from '@/lib/types'

const e = (id: string, extra: Partial<HistoryEntry> = {}) => ({ id, at: 0, actorName: '', userId: 'u', byAgent: false, summary: id, personIds: [], ...extra }) as HistoryEntry

describe('Ctrl+Z and Ctrl+Shift+Z', () => {
  it('undo takes back the newest change still in force, past earlier undos', () => {
    // Newest first: B was undone (U), A is still in force.
    const list = [e('U', { undoOf: 'B' }), e('B', { undoneAt: 1 }), e('A')]
    expect(undoTarget(list, false)?.id).toBe('A')
  })
  it('redo brings back the last undone change, and a redo is itself undone by the next Ctrl+Z', () => {
    const undone = [e('U', { undoOf: 'B' }), e('B', { undoneAt: 1 }), e('A')]
    expect(undoTarget(undone, true)?.id).toBe('U')
    // After the redo R (it undid U), Ctrl+Z takes R back, and there is nothing left to redo.
    const redone = [e('R', { undoOf: 'U' }), e('U', { undoOf: 'B', undoneAt: 2 }), e('B', { undoneAt: 1 }), e('A')]
    expect(undoTarget(redone, false)?.id).toBe('R')
    expect(undoTarget(redone, true)).toBeNull()
  })
  it('a new change after an undo leaves nothing to redo', () => {
    const list = [e('C'), e('U', { undoOf: 'B' }), e('B', { undoneAt: 1 })]
    expect(undoTarget(list, true)).toBeNull()
    expect(undoTarget(list, false)?.id).toBe('C')
  })
})
