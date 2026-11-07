'use client'
import { useRef, useState } from 'react'
import { AudioLines, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useApp } from '@/lib/client'
import { useModel } from '@/lib/smart/models'
import { ModelPrompt } from './model-prompt'
import { useSmart } from '@/lib/smart/settings'
import type { SpeechProgress } from '@/lib/smart/speech'

/** Turns a recording into text in this browser. The text lands in the field beside it, for a person to correct. */
export function TranscribeButton({ getAudio, current, onText }: { getAudio: () => Promise<Blob>; current: string; onText: (text: string) => void }) {
  const { t, lang } = useApp()
  const [on] = useSmart('speech')
  const model = useModel('speech')
  const [progress, setProgress] = useState<SpeechProgress | null>(null)
  const [problem, setProblem] = useState('')
  const stop = useRef<AbortController | null>(null)
  if (!on) return null
  if (model.status !== 'ready') return <ModelPrompt pack="speech">{t('Чтобы запись сама превращалась в текст, скачайте модель. Она работает в этом браузере, голос никуда не уходит.')}</ModelPrompt>
  const start = async () => {
    setProblem('')
    stop.current = new AbortController()
    const before = current.trim()
    const join = (text: string) => (before ? `${before}\n\n${text}` : text)
    setProgress({ stage: 'preparing' })
    try {
      const { transcribe } = await import('@/lib/smart/speech')
      const text = await transcribe(await getAudio(), lang, (p) => { setProgress(p); if (p.stage === 'reading' && p.text) onText(join(p.text)) }, stop.current.signal)
      onText(join(text))
      if (!text.trim()) setProblem(t('В записи не удалось разобрать речь'))
    } catch (e) {
      if ((e as Error).name !== 'AbortError') { console.error(e); setProblem(t('Не удалось расшифровать запись.')) }
    }
    setProgress(null)
  }
  const words = !progress ? '' : progress.stage === 'preparing' ? t('Готовлюсь…') : progress.stage === 'download' ? t('Запускаю модель…') : `${t('Расшифровываю')}: ${Math.round(progress.share * 100)}%`
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
      {progress
        ? <><span role="status">{words}</span><Button type="button" variant="outline" size="sm" onClick={() => stop.current?.abort()}><Square /> {t('Остановить')}</Button></>
        : <><Button type="button" variant="outline" size="sm" onClick={start}><AudioLines /> {t('Расшифровать запись')}</Button><span>{t('Работает на этом устройстве. Проверьте текст: нейросеть ошибается в именах.')}</span></>}
      {problem && <p role="alert" className="w-full text-destructive">{problem}</p>}
    </div>
  )
}
