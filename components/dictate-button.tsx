'use client'
import { useEffect, useRef, useState } from 'react'
import { Loader2, Mic, Square } from 'lucide-react'
import { PromptInputButton } from '@/components/ai-elements/prompt-input'
import { useApp } from '@/lib/client'
import { useSmart } from '@/lib/smart/settings'
import { clock, useRecorder } from '@/lib/use-recorder'

const NO_MIC = { insecure: 'Запись голоса работает только по защищённому адресу (https).', unsupported: 'Этот браузер не умеет записывать звук.', denied: 'Нет доступа к микрофону. Разрешите его в браузере.' }

/** Writes what is said into the field of the form it stands in: it reads on this device, and the person sends it. */
export function DictateButton() {
  const { t, lang, notify } = useApp()
  const [on] = useSmart('speech')
  const rec = useRecorder()
  const [reading, setReading] = useState(false)
  const self = useRef<HTMLSpanElement>(null)
  const stopReading = useRef<AbortController | null>(null)
  const { clip, reset, problem } = rec

  useEffect(() => { if (problem) notify(t(NO_MIC[problem])) }, [problem]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => stopReading.current?.abort(), [])
  useEffect(() => {
    if (!clip) return
    const blob = clip.blob
    reset()
    const stop = (stopReading.current = new AbortController())
    setReading(true)
    const write = (text: string) => {
      const field = self.current?.closest('form')?.querySelector('textarea')
      if (!field) return
      // Through the browser's own setter, so the form sees it as if it were typed.
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, field.value.trim() ? `${field.value.trim()} ${text}` : text)
      field.dispatchEvent(new Event('input', { bubbles: true }))
      field.focus()
    }
    import('@/lib/smart/speech')
      .then(({ transcribe }) => transcribe(blob, lang, () => {}, stop.signal))
      .then((text) => { if (text.trim()) write(text.trim()); else notify(t('В записи не удалось разобрать речь')) })
      .catch((e) => { if (e.name !== 'AbortError') { console.error(e); notify(t('Не удалось расшифровать запись. Проверьте соединение: модель скачивается при первом запуске.')) } })
      .finally(() => setReading(false))
  }, [clip]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!on) return null
  return (
    <span ref={self} className="contents">
      {reading
        ? <PromptInputButton aria-label={t('Остановить расшифровку')} title={t('Остановить расшифровку')} onClick={() => stopReading.current?.abort()}><Loader2 size={15} className="animate-spin" /></PromptInputButton>
        : rec.recording
          ? <PromptInputButton aria-label={t('Остановить запись')} title={t('Остановить запись')} onClick={rec.stop}><Square size={13} className="fill-destructive text-destructive" /> <span className="text-xs tabular-nums">{clock(rec.seconds)}</span></PromptInputButton>
          : <PromptInputButton aria-label={t('Сказать голосом')} title={t('Сказать голосом')} data-hint={t('Текст распознаётся на этом устройстве, потом его можно поправить и отправить.')} onClick={rec.start}><Mic size={15} /></PromptInputButton>}
    </span>
  )
}
