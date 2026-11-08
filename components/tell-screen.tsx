'use client'
import { useEffect, useRef, useState } from 'react'
import { Mic, RotateCcw, Send, Square, Upload } from 'lucide-react'
import { translate } from '@/lib/i18n'
import type { Lang } from '@/lib/types'
import { clock, useRecorder } from '@/lib/use-recorder'
import { Logo } from './logo'

const big = 'flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl px-5 text-xl font-medium disabled:opacity-50'
const TOPICS = ['Что вам запомнилось больше всего?', 'Где жила семья? Какой был дом?', 'Какую историю рассказывают в семье?', 'Что важно не забыть?']

/** For someone who has never seen the app, perhaps on an old phone: one thing on the screen, in large letters. */
export function TellScreen({ token, info, lang }: { token: string; info: { about: string; tellerName: string; question: string; familyName: string } | null; lang: Lang }) {
  const t = (k: string) => translate(lang, k)
  const rec = useRecorder()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(0)
  const [error, setError] = useState('')
  const [url, setUrl] = useState('')
  const audio = rec.clip?.blob ?? file
  const asked = info ? info.question.split('\n').map((q) => q.trim()).filter(Boolean) : []
  const [topic, setTopic] = useState(0)
  useEffect(() => {
    document.documentElement.lang = lang
    if (!audio) return setUrl('')
    const u = URL.createObjectURL(audio)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [audio, lang])
  const again = () => { rec.reset(); setFile(null); setError('') }
  const send = async () => {
    if (!audio) return
    setBusy(true)
    setError('')
    try {
      const form = new FormData()
      form.set('audio', audio, file?.name ?? 'voice')
      if (rec.clip) form.set('seconds', String(rec.clip.seconds))
      if (asked.length) form.set('topic', String(topic))
      const r = await fetch(`/api/tell/${token}`, { method: 'POST', body: form })
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? String(r.status))
      setSent((n) => n + 1)
      again()
    } catch (e) {
      setError(`${t('Не получилось отправить. Запись цела, попробуйте ещё раз.')} ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }
  if (!info) {
    return (
      <main className="canvas !overflow-auto !cursor-default grid place-items-center p-5">
        <div className="flex max-w-md flex-col gap-3 text-center"><Logo size={48} className="self-center" /><h1 className="font-serif text-2xl font-medium">{t('Ссылка недействительна')}</h1><p className="text-lg text-ink-soft">{t('Ссылка устарела или уже использована. Попросите новую.')}</p></div>
      </main>
    )
  }
  return (
    <main className="canvas !overflow-auto !cursor-default flex justify-center p-5">
      <div className="flex w-full max-w-md flex-col gap-5 pb-10 text-lg leading-snug">
        <div className="flex items-center gap-2 text-base text-ink-soft"><Logo size={28} />{info.familyName}</div>
        {sent > 0 && !audio && !rec.recording && <p role="status" className="rounded-2xl bg-muted p-4 font-medium">{t('Спасибо! Запись отправлена семье.')}</p>}
        <div>
          <h1 className="font-serif text-3xl font-medium break-anywhere">{info.tellerName ? `${info.tellerName}, ${t('расскажите, пожалуйста')}` : t('Расскажите, пожалуйста')}</h1>
          {asked.length === 1 && <p className="mt-2 text-xl break-anywhere">{asked[0]}</p>}
          {asked.length === 0 && <p className="mt-2 text-xl break-anywhere">{t('О ком')}: {info.about}</p>}
          {asked.length > 0 && <p className="mt-1 text-base text-ink-soft break-anywhere">{t('О ком')}: {info.about}</p>}
        </div>
        {/* Several questions: one is chosen before each recording, so the family knows which answer this is. */}
        {asked.length > 1 && !audio && !rec.recording && (
          <div role="radiogroup" aria-label={t('О чём рассказать')} className="flex flex-col gap-2">
            <p className="text-base text-ink-soft">{t('Выберите вопрос и запишите ответ. Потом можно ответить на следующий.')}</p>
            {asked.map((q, i) => (
              <button key={i} role="radio" aria-checked={topic === i} className={`min-h-14 rounded-2xl border px-4 py-2 text-left text-lg break-anywhere ${topic === i ? 'border-ink bg-white font-medium' : 'border-border bg-white/60'}`} onClick={() => setTopic(i)}>{q}</button>
            ))}
          </div>
        )}
        {asked.length > 1 && (audio || rec.recording) && <p className="text-lg font-medium break-anywhere">{asked[topic]}</p>}

        {rec.recording ? (
          <button className={`${big} bg-rust text-white`} onClick={rec.stop}><Square size={26} fill="currentColor" /> {t('Закончить')} · {clock(rec.seconds)}</button>
        ) : audio ? (
          <div className="flex flex-col gap-3">
            <audio controls className="w-full" src={url || undefined} />
            <button className={`${big} bg-ink text-white`} disabled={busy} onClick={send}><Send size={24} /> {busy ? t('Отправляем…') : t('Отправить семье')}</button>
            <button className={`${big} border border-border bg-white`} disabled={busy} onClick={again}><RotateCcw size={22} /> {t('Записать заново')}</button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <button className={`${big} bg-ink text-white`} onClick={rec.start}><Mic size={28} /> {sent ? t('Записать ещё') : t('Начать запись')}</button>
            <input ref={input} type="file" accept="audio/*,.m4a,.mp3,.wav,.ogg,.flac,.webm,.opus" hidden aria-label={t('Выбрать запись с телефона')} onChange={(e) => { rec.reset(); setFile(e.target.files?.[0] ?? null); e.target.value = '' }} />
            <button className={`${big} ${rec.problem ? 'bg-ink text-white' : 'border border-border bg-white'}`} onClick={() => input.current?.click()}><Upload size={22} /> {t('Уже есть запись')}</button>
          </div>
        )}
        {rec.problem && !audio && <p role="alert" className="text-base">{t(rec.problem === 'denied' ? 'Браузер не дал доступ к микрофону. Можно записать голос в обычной программе на телефоне и выбрать файл.' : 'Здесь запись прямо в браузере не работает. Запишите голос в обычной программе на телефоне и выберите файл.')}</p>}
        {error && <p role="alert" className="text-base text-destructive">{error}</p>}
        {!audio && !rec.recording && asked.length < 2 && (
          <div className="text-base text-ink-soft">
            <p className="font-medium">{t('Если не знаете, с чего начать:')}</p>
            <ul className="mt-1 list-disc pl-5">{TOPICS.map((k) => <li key={k}>{t(k)}</li>)}</ul>
          </div>
        )}
        <p className="text-sm text-ink-soft">{t('Запись получит тот, кто прислал вам эту ссылку, и решит, добавлять ли её в семейный архив.')}</p>
      </div>
    </main>
  )
}
