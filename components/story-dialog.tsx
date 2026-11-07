'use client'
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Circle, Square, X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { api, useApp } from '@/lib/client'
import { clock, useRecorder } from '@/lib/use-recorder'
import { personName, type Person, type Story } from '@/lib/types'
import { PersonPopover } from './person-pickers'
import { Select } from '@/components/ui/select'
import { TranscribeButton } from './transcribe-button'
import { inputClass } from '@/components/ui/input'

const input = inputClass
const label = 'flex flex-col gap-1 text-xs text-ink-soft'
const primary = 'h-9 self-start rounded-lg bg-ink px-3 text-sm text-white disabled:opacity-40'
const NO_MIC = { insecure: 'Запись голоса работает только по защищённому адресу (https). Можно выбрать файл.', unsupported: 'Этот браузер не умеет записывать звук. Можно выбрать файл.', denied: 'Нет доступа к микрофону. Разрешите его в браузере или выберите файл.' }

/** A voice from the microphone or from a file, with the words as far as anyone has written them down. */
export function StoryDialog({ person, story, onClose }: { person: Person; story: Story | null; onClose: () => void }) {
  const { t, me, lang, canEdit, byId, notify } = useApp()
  const qc = useQueryClient()
  const rec = useRecorder()
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState(story?.title ?? '')
  const [body, setBody] = useState(story?.body ?? '')
  const [tellerId, setTellerId] = useState<string | null>(story ? story.tellerId : me.personId)
  const [tellerName, setTellerName] = useState(story?.tellerName ?? '')
  const [toldOn, setToldOn] = useState(story?.toldOn ?? new Date().toLocaleDateString(lang))
  const [about, setAbout] = useState<string[]>(story?.about ?? [person.id])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const teller = tellerId ? byId.get(tellerId) : null
  const hidden = [...byId.values()].filter((p) => p.hidden).map((p) => p.id)
  const nameOf = (id: string) => { const p = byId.get(id); return p ? personName(p) : '' }
  const save = async () => {
    setBusy(true)
    setError('')
    const fields = { title, body, tellerId, tellerName: tellerId ? '' : tellerName, toldOn, about }
    try {
      if (story) {
        await api(`stories/${story.id}`, { method: 'PATCH', json: { ...fields, baseUpdatedAt: story.updatedAt } })
      } else {
        const form = new FormData()
        const voice = rec.clip?.blob ?? file
        form.set('story', JSON.stringify({ ...fields, ...(rec.clip ? { durationSec: rec.clip.seconds } : {}) }))
        if (voice) form.set('audio', voice, file?.name ?? 'voice')
        const r = await fetch('/api/v1/stories', { method: 'POST', body: form })
        if (!r.ok) throw Object.assign(new Error((await r.json().catch(() => null))?.error ?? r.statusText), { status: r.status })
        if (!canEdit) notify(t('Рассказ отправлен. Его посмотрит тот, кто ведёт архив.'))
      }
      await qc.invalidateQueries({ queryKey: ['stories'] })
      await qc.invalidateQueries({ queryKey: ['proposals'] })
      onClose()
    } catch (e) {
      const { status, message } = e as Error & { status?: number }
      setError(status === 409 ? t('Этот рассказ изменил другой человек. Откройте его заново.') : String(message))
      setBusy(false)
    }
  }
  const preview = rec.clip?.blob ?? file
  // One address per recording: a new one on each key press would restart the player.
  const [previewUrl, setPreviewUrl] = useState('')
  useEffect(() => {
    if (!preview) return setPreviewUrl('')
    const url = URL.createObjectURL(preview)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [preview])
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg max-h-[calc(100dvh-32px)] overflow-auto">
        <DialogTitle className="font-serif text-lg font-medium">{t(story ? 'Изменить рассказ' : 'Записать рассказ')}</DialogTitle>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save() }}>
          {!story && (
            <div className="flex flex-col gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
              {!rec.recording && !preview && (
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className="bar-btn border border-border bg-white" onClick={rec.start}><Circle size={12} className="fill-destructive text-destructive" /> {t('Записать голос')}</button>
                  <label className="text-xs text-ink-soft underline underline-offset-2 cursor-pointer">{t('Или выберите файл')}
                    <input type="file" accept="audio/*,.m4a,.mp3,.wav,.ogg,.flac,.webm" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  </label>
                </div>
              )}
              {rec.recording && (
                <div className="flex items-center gap-3" role="status">
                  <span className="flex items-center gap-1.5"><Circle size={10} className="fill-destructive text-destructive animate-pulse" /> {t('Идёт запись')} {clock(rec.seconds)}</span>
                  <button type="button" className="bar-btn border border-border bg-white" onClick={rec.stop}><Square size={12} /> {t('Остановить')}</button>
                </div>
              )}
              {preview && !rec.recording && (
                <div className="flex items-center gap-2">
                  <audio controls className="h-9 min-w-0 flex-1" src={previewUrl || undefined} />
                  <button type="button" className="text-ink-soft hover:text-ink" aria-label={t('Удалить запись')} title={t('Удалить запись')} onClick={() => { rec.reset(); setFile(null) }}><X size={15} /></button>
                </div>
              )}
              {rec.problem && <p role="alert" className="text-xs text-destructive">{t(NO_MIC[rec.problem])}</p>}
            </div>
          )}
          <label className={label}>{t('Название')}
            <input className={input} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
            <div className={label}>{t('Кто рассказывает')}
              <div className="flex items-center gap-1">
                <PersonPopover onPick={setTellerId} exclude={hidden}>
                  <button type="button" className={`${input} flex-1 truncate`}>{teller ? personName(teller) : t('Выбрать человека')}</button>
                </PersonPopover>
                {teller && <button type="button" className="text-ink-soft hover:text-ink" aria-label={t('Убрать')} title={t('Убрать')} onClick={() => setTellerId(null)}><X size={14} /></button>}
              </div>
              {!teller && <input className={input} aria-label={t('Или просто имя')} placeholder={t('Или просто имя')} maxLength={120} value={tellerName} onChange={(e) => setTellerName(e.target.value)} />}
            </div>
            <label className={label}>{t('Когда рассказано')}
              <input className={input} maxLength={60} value={toldOn} onChange={(e) => setToldOn(e.target.value)} />
            </label>
          </div>
          <div className={label}>{t('О ком этот рассказ')}
            <div className="flex flex-wrap items-center gap-1.5">
              {about.map((id) => (
                <span key={id} className="flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-sm text-ink">
                  {nameOf(id)}
                  {about.length > 1 && <button type="button" aria-label={`${t('Убрать')}: ${nameOf(id)}`} className="text-ink-soft hover:text-ink" onClick={() => setAbout(about.filter((x) => x !== id))}><X size={12} /></button>}
                </span>
              ))}
              <PersonPopover onPick={(id) => setAbout(about.includes(id) ? about : [...about, id])} exclude={[...about, ...hidden]}>
                <button type="button" className="text-xs underline underline-offset-2 hover:text-ink">{t('Добавить человека')}</button>
              </PersonPopover>
            </div>
          </div>
          <label className={label}>{t('Текст или расшифровка')}
            <textarea className="min-h-24 rounded-lg border border-input bg-white px-3 py-2 text-sm text-ink" maxLength={20000} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          {(preview || story?.hasAudio) && !rec.recording && <TranscribeButton current={body} onText={setBody} getAudio={async () => { if (preview) return preview; const r = await fetch(`/api/v1/stories/${story!.id}/audio`); if (!r.ok) throw new Error(r.statusText); return r.blob() }} />}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <button className={primary} disabled={busy || rec.recording || (!story && !preview && !body.trim())}>{t('Сохранить')}</button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** One sentence of a story becomes a fact on someone's record, and the fact says where it came from. */
export function StoryFactDialog({ story, teller, person, onClose }: { story: Story; teller: string; person: Person; onClose: () => void }) {
  const { t, byId, notify } = useApp()
  const qc = useQueryClient()
  const [personId, setPersonId] = useState(person.id)
  const [kind, setKind] = useState('')
  const [date, setDate] = useState('')
  const [place, setPlace] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const source = [`${t('Рассказ')}${story.title ? ` «${story.title}»` : ''}`, teller && `${t('Со слов').toLowerCase()}: ${teller}`, story.toldOn].filter(Boolean).join(', ')
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogTitle className="font-serif text-lg font-medium">{t('Факт из рассказа')}</DialogTitle>
        <form className="flex flex-col gap-3" onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          const target = byId.get(personId)!
          try {
            await api(`persons/${personId}`, { method: 'PATCH', json: { facts: [...target.facts, { kind: kind.trim(), date: date.trim(), place: place.trim(), note: note.trim(), source }] } })
            await qc.invalidateQueries({ queryKey: ['graph'] })
            onClose()
          } catch (x) {
            notify(String((x as Error).message))
            setBusy(false)
          }
        }}>
          <p className="text-sm text-ink-soft">{t('Источником будет этот рассказ. Факт появится в сведениях со ссылкой на него.')}</p>
          {story.about.length > 1 && (
            <label className={label}>{t('О ком этот рассказ')}
              <Select aria-label={t('О ком этот рассказ')} value={personId} onChange={setPersonId} options={story.about.map((id) => ({ value: id, label: personName(byId.get(id)!) }))} />
            </label>
          )}
          <label className={label}>{t('Что произошло')}
            <input className={input} required maxLength={80} value={kind} onChange={(e) => setKind(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className={label}>{t('Дата')}<input className={input} maxLength={60} value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className={label}>{t('Место')}<input className={input} maxLength={120} value={place} onChange={(e) => setPlace(e.target.value)} /></label>
          </div>
          <label className={label}>{t('Подробности')}
            <textarea className="min-h-16 rounded-lg border border-input bg-white px-3 py-2 text-sm text-ink" maxLength={800} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <p className="text-xs text-ink-soft">{t('Источник')}: {source}</p>
          <button className={primary} disabled={busy}>{t('Сохранить')}</button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
