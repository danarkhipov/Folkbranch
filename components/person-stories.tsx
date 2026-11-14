'use client'
import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { EyeOff, Mic, Pencil, ScrollText, Trash2 } from 'lucide-react'
import { api, useApp } from '@/lib/client'
import { personName, type Person, type Story } from '@/lib/types'
import { ReadText } from './person-fields'

const StoryDialog = dynamic(() => import('./story-dialog').then((m) => m.StoryDialog), { ssr: false })
const StoryFactDialog = dynamic(() => import('./story-dialog').then((m) => m.StoryFactDialog), { ssr: false })

/** A recording from a browser may not say how long it is until read to the end, and without that the player cannot jump. */
function Voice({ id }: { id: string }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const a = ref.current
    if (!a) return
    const measure = () => {
      if (a.duration !== Infinity) return
      const back = () => { if (a.duration === Infinity) return; a.removeEventListener('durationchange', back); a.currentTime = 0 }
      a.addEventListener('durationchange', back)
      a.currentTime = 1e7
    }
    a.addEventListener('loadedmetadata', measure)
    return () => a.removeEventListener('loadedmetadata', measure)
  }, [])
  return <audio ref={ref} controls preload="metadata" className="mt-1.5 h-9 w-full" src={`/api/v1/stories/${id}/audio`} />
}

export function StoriesTab({ person }: { person: Person }) {
  const { t, canEdit, me, byId, confirm, notify } = useApp()
  const qc = useQueryClient()
  const key = ['stories', person.id]
  const { data: stories = [] } = useQuery({ queryKey: key, queryFn: () => api<Story[]>(`persons/${person.id}/stories`) })
  const [editing, setEditing] = useState<Story | 'new' | null>(null)
  const [fact, setFact] = useState<Story | null>(null)
  const teller = (s: Story) => {
    const p = s.tellerId ? byId.get(s.tellerId) : null
    return (p && personName(p)) || s.tellerName
  }
  const remove = async (s: Story) => {
    if (!(await confirm(s.title ? t('Удалить рассказ «{name}»?').replace('{name}', () => s.title) : t('Удалить рассказ?'), t('Удалить'), t('Вернуть можно в разделе «История».')))) return
    await api(`stories/${s.id}`, { method: 'DELETE' }).catch((e) => notify(String(e.message)))
    qc.invalidateQueries({ queryKey: ['stories'] })
    qc.invalidateQueries({ queryKey: ['history'] })
  }
  // Only who may see it changes; everything else is sent as it was read.
  const setPrivate = async (s: Story, keepPrivate: boolean) => {
    await api(`stories/${s.id}`, { method: 'PATCH', json: { title: s.title, body: s.body, tellerId: s.tellerId, tellerName: s.tellerName, toldOn: s.toldOn, about: s.about, durationSec: s.durationSec, keepPrivate, baseUpdatedAt: s.updatedAt } }).catch((e) => notify(String(e.message)))
    qc.invalidateQueries({ queryKey: ['stories'] })
    qc.invalidateQueries({ queryKey: ['history'] })
  }
  return (
    <div className="px-4 py-4 flex flex-col gap-3">
      {!me.guest && <button className="add-btn self-start" onClick={() => setEditing('new')}><Mic size={14} /> {t('Записать рассказ')}</button>}
      {<p className="text-xs text-ink-soft">{t('Рассказы хранятся отдельно от сведений: это чьи-то слова, а не проверенные факты.')}</p>}
      {!stories.length && <p className="text-sm text-ink-faint">{t('Рассказов пока нет')}</p>}
      {stories.map((s) => {
        const who = teller(s)
        const line = [who && `${t('Со слов')}: ${who}`, s.toldOn, s.createdBy && `${t('Добавлено')}: ${s.createdBy}`].filter(Boolean).join(' · ')
        return (
          <article key={s.id} className="min-w-0 rounded-lg border border-border bg-white/60 px-3 py-2">
            {s.title && <h4 className="font-serif text-base font-medium leading-snug break-anywhere">{s.title}</h4>}
            {line && <p className="text-xs text-ink-soft break-anywhere">{line}</p>}
            {s.keepPrivate && <p className="flex items-center gap-1 text-xs text-ink-soft"><EyeOff size={12} /> {t('Только для редакторов')}</p>}
            {s.hasAudio && <Voice id={s.id} />}
            {s.body && <p className="mt-1.5 text-sm leading-relaxed"><ReadText value={s.body} /></p>}
            {canEdit && (
              <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-ink-soft">
                <button className="flex items-center gap-1 hover:text-ink" onClick={() => setFact(s)}><ScrollText size={12} /> {t('Сделать фактом')}</button>
                <button className="flex items-center gap-1 hover:text-ink" onClick={() => setPrivate(s, !s.keepPrivate)}><EyeOff size={12} /> {t(s.keepPrivate ? 'Показать читателям' : 'Скрыть от читателей')}</button>
                <button aria-label={t('Изменить рассказ')} className="flex items-center gap-1 hover:text-ink" onClick={() => setEditing(s)}><Pencil size={12} /> {t('Изменить')}</button>
                <button aria-label={t('Удалить рассказ')} className="ml-auto flex items-center gap-1 hover:text-destructive" onClick={() => remove(s)}><Trash2 size={12} /> {t('Удалить')}</button>
              </div>
            )}
          </article>
        )
      })}
      {editing && <StoryDialog person={person} story={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {fact && <StoryFactDialog story={fact} teller={teller(fact)} person={person} onClose={() => setFact(null)} />}
    </div>
  )
}
