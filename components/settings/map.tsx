'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Section } from '@/components/ui/section'
import { SwitchRow } from '@/components/ui/switch'
import { api, useApp } from '@/lib/client'
import type { ChronicleSwitches } from '@/lib/chronicle'

type Show = 'owner' | 'all'
const KEY = ['chronicle', 'switches']

/** The owner's switches for what agents write about the times around the family: shapes on the map, words beside it. */
export function MapSettings() {
  const { t } = useApp()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: KEY, queryFn: () => api<ChronicleSwitches>('chronicle/switches') })
  const [failed, setFailed] = useState(false)
  if (!data) return null
  // Shown at once; the map follows when the answer is in, and a refusal puts the switch back.
  const set = async (change: Partial<Pick<ChronicleSwitches, 'history' | 'chronicle' | 'show'>>) => {
    setFailed(false)
    qc.setQueryData<ChronicleSwitches>(KEY, (d) => (d ? { ...d, ...change } : d))
    try {
      qc.setQueryData(KEY, await api<ChronicleSwitches>('chronicle', { method: 'PUT', json: change }))
    } catch {
      setFailed(true)
    }
    await qc.invalidateQueries({ queryKey: ['chronicle'] })
  }
  const show: Show = data.show === 'all' ? 'all' : 'owner'
  const who: [Show, string, string][] = [
    ['owner', t('Only you'), t('Agents fill it in while you check it.')],
    ['all', t('Everyone with access'), t('Editors, readers and share links, each without the relatives hidden from them.')],
  ]
  return (
    <div className="flex min-w-0 max-w-xl flex-col gap-7 text-sm">
      <Section title={t('On the family map')}>
        <SwitchRow title={t('History on the map')} description={t('Zones, routes and places of the past drawn under the family, added by agents through the API.')} checked={data.history} onChange={(history) => set({ history })} />
        <SwitchRow title={t('Chronicle')} description={t('Marks on the timeline, the year\'s entry and a front page beside the map, written by agents through the API.')} checked={data.chronicle} onChange={(chronicle) => set({ chronicle })} />
        {data.entries === 0 && <p className="text-xs text-ink-soft">{t('No entries yet. Agents add them through the API.')}</p>}
      </Section>
      {(data.history || data.chronicle) && (
        <Section title={t('Who sees it')}>
          <div role="radiogroup" aria-label={t('Who sees it')} className="grid gap-2 sm:grid-cols-2">
            {who.map(([value, title, about]) => (
              <button key={value} type="button" role="radio" aria-checked={show === value} onClick={() => show !== value && set({ show: value })}
                className={`min-h-11 rounded-lg border p-2.5 text-left transition-colors ${show === value ? 'border-ink bg-white' : 'border-border hover:border-ink-faint'}`}>
                <b className="block font-medium">{title}</b>
                <span className="block text-xs text-ink-soft">{about}</span>
              </button>
            ))}
          </div>
        </Section>
      )}
      {failed && <p role="alert" className="text-xs text-destructive">{t('Could not save')}</p>}
    </div>
  )
}
