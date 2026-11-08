'use client'
import { draftsLeft } from './autosave'

/**
 * Leaves nothing of the family on this device. The server's answer tells the browser to empty its cache
 * of photos; typed text that was never sent and the face prints go here. Downloaded models and the
 * layout of the screen stay: they say nothing about anyone.
 */
export async function signOut() {
  await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  for (const k of draftsLeft()) try { localStorage.removeItem(k) } catch {}
  await new Promise((done) => {
    try {
      const q = indexedDB.deleteDatabase('folkbranch-face-prints')
      q.onsuccess = q.onerror = q.onblocked = done
    } catch {
      done(null)
    }
  })
  location.href = '/login'
}
