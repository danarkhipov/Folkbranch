'use client'
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FlaskConical, KeyRound, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/ui/section'
import { Select } from '@/components/ui/select'
import { api, useApp } from '@/lib/client'
import { PayChoice, PlanLines, type Pay } from '../plan-badge'
import { STT_PRESETS, sttPreset, type SttId, type SttPreset } from '@/lib/transcribe/presets'

interface Status {
  presets: SttPreset[]
  current: { provider: SttId; model: string; baseUrl: string | null; source: 'server' | 'app'; keyEnding: string | null; sameKey: boolean; limitMinutes: number } | null
  assistant: string | null
  usage: { month: string; minutes: number; dollars: number; requests: number }
}

const input = 'h-9 w-full rounded-lg border border-input bg-white px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring/40'
const hour = (p: SttPreset['models'][number]) => (p.perMinute === null ? null : p.perMinute === 0 ? 'бесплатно' : `$${(p.perMinute * 60).toFixed(2)} в час`)

/** Where the owner connects one speech service for everyone and pays for it. Editors only use it. */
export function CloudSpeech() {
  const { t, confirm: ask } = useApp()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['stt'], queryFn: () => api<Status>('transcription') })
  const [provider, setProvider] = useState<SttId>('groq')
  const [model, setModel] = useState('')
  const [key, setKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [same, setSame] = useState(false)
  const [limit, setLimit] = useState('600')
  const [pay, setPay] = useState<Pay>('paid')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null)
  const cur = data?.current ?? null
  useEffect(() => {
    if (!cur) return
    setProvider(cur.provider); setModel(cur.model); setBaseUrl(cur.baseUrl ?? ''); setSame(cur.sameKey); setLimit(String(cur.limitMinutes))
  }, [cur?.provider, cur?.model, cur?.baseUrl, cur?.sameKey, cur?.limitMinutes]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return null
  const preset = sttPreset(provider)!
  const locked = cur?.source === 'server'
  const refresh = () => qc.invalidateQueries({ queryKey: ['stt'] }).then(() => qc.invalidateQueries({ queryKey: ['stt-info'] }))
  const run = async (what: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(what); setMessage(null)
    try { await fn(); await refresh(); setKey(''); setMessage({ text: t(done), bad: false }) } catch (e) { setMessage({ text: (e as Error).message, bad: true }) } finally { setBusy('') }
  }
  const save = () => run('save', () => api('transcription', { method: 'PUT', json: { provider, model: model || preset.models[0].id, ...(provider === 'custom' ? { baseUrl } : {}), ...(same ? { sameKey: true } : { key: key || undefined }), limitMinutes: Number(limit) || 0 } }), 'Сохранено. Ключ проверен: этот запрос ничего не стоил')
  const canBorrow = !!preset.assistantKey && data.assistant === preset.assistantKey
  return (
    <div className="flex min-w-0 flex-col gap-7 text-sm">
      <Section title={t('Расшифровка в облаке')} description={t('Вы подключаете один сервис распознавания речи и платите за него сами. Все редакторы архива пользуются им без своих ключей, а запись идёт через ваш сервер и нигде в архиве не хранится. Кто не хочет отправлять голос наружу, остаётся с моделями на своём устройстве.')}>
        {cur ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-ink-soft" role="status">
            {t('Подключено')}: {t(sttPreset(cur.provider)!.label)}, {cur.model}{cur.keyEnding ? `, ${t('ключ')} …${cur.keyEnding}` : cur.sameKey ? `, ${t('ключ ассистента')}` : ''}{locked ? `. ${t('Задано в настройках сервера')}` : ''}.
            {' '}{t('Этот месяц')}: {data.usage.minutes} {t('мин')}, {data.usage.requests} {t('запросов')}, ≈ ${data.usage.dollars}{cur.limitMinutes ? ` · ${t('предел')} ${cur.limitMinutes} ${t('мин')}` : ''}
          </p>
        ) : <p className="text-xs text-ink-soft">{t('Пока не подключено: расшифровка работает только на устройствах, моделями из «Лица и голос».')}</p>}
        {!locked && (
          <>
            <PayChoice value={pay} onChange={(v) => { setPay(v); if (v === 'free' && !preset.free) { const first = STT_PRESETS.find((p) => p.free); if (first) { setProvider(first.id); setModel('') } } }} />
            <div role="radiogroup" aria-label={t('Сервис')} className="grid gap-2 sm:grid-cols-2">
              {STT_PRESETS.filter((p) => pay !== 'free' || p.free).map((p) => (
                <button key={p.id} role="radio" aria-checked={provider === p.id} type="button" onClick={() => { setProvider(p.id); setModel(''); setSame(false); setMessage(null) }} className={`rounded-lg border p-2.5 text-left transition-colors ${provider === p.id ? 'border-ink bg-white' : 'border-border hover:border-ink-faint'}`}>
                  <b className="block font-medium">{t(p.label)}</b>
                  <span className="block text-xs text-ink-soft">{t(p.pitch)}</span>
                  <PlanLines free={p.free} show={pay} />
                </button>
              ))}
            </div>
            {preset.id === 'custom' ? (
              <label className="flex flex-col gap-1 text-xs text-ink-soft">
              {t('Модель')}
              {preset.id === 'custom' ? <input className={`${input} font-mono`} aria-label={t('Модель')} value={model} placeholder="whisper-1" onChange={(e) => setModel(e.target.value)} /> : (
                <Select aria-label={t('Модель')} value={model || preset.models[0].id} onChange={setModel} options={preset.models.map((m) => ({ value: m.id, label: `${t(m.label)}${hour(m) ? ` · ${t(hour(m)!)}` : ''}` }))} />
              )}
              {preset.models.find((m) => m.id === (model || preset.models[0].id))?.note && <span>{t(preset.models.find((m) => m.id === (model || preset.models[0].id))!.note!)}</span>}
            </label>
            ) : (
              <details>
                <summary className="cursor-pointer text-xs text-ink-soft">{t('Для опытных: выбрать модель самому')}</summary>
                <div className="mt-2 flex flex-col gap-1">
                  <p className="text-xs text-ink-soft">{t('Если не выбирать, берётся проверенная модель сервиса, а когда сервис выпустит новее в той же линейке, приложение перейдёт на неё само.')}</p>
                  <label className="flex flex-col gap-1 text-xs text-ink-soft">
              {t('Модель')}
              <Select aria-label={t('Модель')} value={model || preset.models[0].id} onChange={setModel} options={preset.models.map((m) => ({ value: m.id, label: `${t(m.label)}${hour(m) ? ` · ${t(hour(m)!)}` : ''}` }))} />
              {preset.models.find((m) => m.id === (model || preset.models[0].id))?.note && <span>{t(preset.models.find((m) => m.id === (model || preset.models[0].id))!.note!)}</span>}
            </label>
                </div>
              </details>
            )}
            {preset.id === 'custom' && <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Адрес сервера')}<input className={input} aria-label={t('Адрес сервера')} value={baseUrl} placeholder="http://192.168.1.10:8000/v1" onChange={(e) => setBaseUrl(e.target.value)} /></label>}
            {canBorrow && <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="accent-[var(--ink)]" checked={same} onChange={(e) => setSame(e.target.checked)} />{t('Использовать ключ ассистента: тот же сервис, ничего вставлять не надо')}</label>}
            {!same && (
              <label className="flex flex-col gap-1 text-xs text-ink-soft">
                {t('Ключ сервиса')}
                <input className={`${input} font-mono`} type="password" autoComplete="off" aria-label={t('Ключ сервиса')} value={key} placeholder={cur && cur.provider === provider && cur.keyEnding ? `…${cur.keyEnding} (${t('оставьте пустым, чтобы не менять')})` : t('Вставьте ключ')} onChange={(e) => setKey(e.target.value)} />
                {preset.keysUrl && <a className="underline" href={preset.keysUrl} target="_blank" rel="noreferrer">{t('Где взять ключ')}</a>}
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs text-ink-soft">
              {t('Предел в месяц, минут записи (0 без предела)')}
              <input className={`${input} max-w-40`} inputMode="numeric" aria-label={t('Предел в месяц')} value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ''))} />
            </label>
            <p className="text-xs text-ink-faint">{t('Запись уйдёт в')}: {t(preset.where)}. {t('Цены сервисов меняются: смотрите их страницы.')} {['openrouter', 'groq'].includes(preset.id) ? t('Проверен.') : t('Не проверен.')}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" loading={busy === 'save'} onClick={save}><KeyRound /> {cur ? t('Сохранить') : t('Подключить')}</Button>
              {cur && <Button type="button" variant="outline" loading={busy === 'test'} onClick={() => run('test', () => api('transcription/test', { method: 'POST', json: {} }), 'Работает: сервис принял пробную запись. Она стоила доли цента')}><FlaskConical /> {t('Проверить на записи тишины')}</Button>}
              {cur && <Button type="button" variant="danger" onClick={async () => { if (await ask(t('Отключить расшифровку в облаке?'), t('Отключить'), t('Редакторы вернутся к моделям на своих устройствах.'))) run('remove', () => api('transcription', { method: 'DELETE' }), 'Отключено') }}><Trash2 /> {t('Отключить')}</Button>}
            </div>
          </>
        )}
        {message && <p role={message.bad ? 'alert' : 'status'} className={`text-xs ${message.bad ? 'text-destructive' : 'text-ink-soft'}`}>{message.text}</p>}
      </Section>
    </div>
  )
}
