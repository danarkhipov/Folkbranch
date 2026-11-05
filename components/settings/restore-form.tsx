'use client'
import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'

type Stage = { name: 'idle' } | { name: 'chosen'; file: File } | { name: 'sending'; percent: number } | { name: 'waiting'; login: string | null } | { name: 'ready'; login: string | null }

/** Sends with a progress bar, since an archive with photos can take minutes. */
function send(file: File, code: string | undefined, onPercent: (n: number) => void) {
  return new Promise<{ login: string | null }>((resolve, reject) => {
    const x = new XMLHttpRequest()
    x.open('POST', '/api/archive')
    x.setRequestHeader('Content-Type', 'application/zip')
    if (code) x.setRequestHeader('x-setup-code', code)
    x.upload.onprogress = (e) => { if (e.lengthComputable) onPercent(Math.round((e.loaded / e.total) * 100)) }
    x.onerror = () => reject(new Error('network'))
    x.onload = () => {
      const body = (() => { try { return JSON.parse(x.responseText) } catch { return {} } })()
      if (x.status === 200) resolve(body)
      else reject(new Error(typeof body.error === 'string' ? body.error : 'error'))
    }
    x.send(file)
  })
}

/** Waits for the server to come back from the restart that puts the copy in place. */
async function serverBack() {
  await new Promise((r) => setTimeout(r, 1500))
  for (let i = 0; i < 120; i++) {
    if (await fetch('/api/health', { cache: 'no-store' }).then((r) => r.ok).catch(() => false)) return
    await new Promise((r) => setTimeout(r, 1000))
  }
}

export function RestoreForm({ t, warning, code }: { t: (key: string) => string; warning: string; code?: string }) {
  const input = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>({ name: 'idle' })
  const [error, setError] = useState('')
  const start = async (file: File) => {
    setError('')
    setStage({ name: 'sending', percent: 0 })
    try {
      const { login } = await send(file, code, (percent) => setStage({ name: 'sending', percent }))
      setStage({ name: 'waiting', login })
      await serverBack()
      setStage({ name: 'ready', login })
    } catch (e) {
      setError((e as Error).message)
      setStage({ name: 'idle' })
    }
  }
  return (
    <div className="flex flex-col gap-2">
      {stage.name === 'idle' && (
        <button type="button" className="bar-btn self-start border border-border" onClick={() => input.current?.click()}><Upload size={14} /> {t('Выбрать файл копии')}</button>
      )}
      <input ref={input} hidden type="file" accept=".zip,application/zip" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) setStage({ name: 'chosen', file }) }} />
      {stage.name === 'chosen' && (
        <div role="alert" className="flex flex-col gap-2 rounded-lg border border-destructive/40 p-3">
          <p className="text-sm">{stage.file.name}</p>
          <p className="text-sm">{warning}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="bar-btn on !bg-destructive" onClick={() => start(stage.file)}>{t('Восстановить из этого файла')}</button>
            <button type="button" className="bar-btn border border-border" onClick={() => setStage({ name: 'idle' })}>{t('Отмена')}</button>
          </div>
        </div>
      )}
      {stage.name === 'sending' && <p role="status" className="text-sm">{stage.percent < 100 ? `${t('Отправляем файл')}: ${stage.percent}%` : t('Проверяем копию')}</p>}
      {stage.name === 'waiting' && <p role="status" className="text-sm">{t('Копия проверена. Сервер перезапускается, это займёт около минуты')}</p>}
      {stage.name === 'ready' && (
        <div role="status" className="flex flex-col gap-2 text-sm">
          <p>{t('Архив восстановлен.')}</p>
          {stage.login ? <a className="bar-btn on self-start" href={stage.login}>{t('Войти в архив')}</a> : <a className="bar-btn on self-start" href="/">{t('Открыть архив')}</a>}
        </div>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
