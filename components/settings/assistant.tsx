'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, useApp } from '@/lib/client'
import { ModelSelect, ProviderForm, useProviderStatus } from '../assistant-setup'
import type { PresetId } from '@/lib/agent/presets'

/** Which provider answers, and changing it. */
function ProviderSettings() {
  const { t } = useApp()
  const qc = useQueryClient()
  const { data } = useProviderStatus()
  const [changing, setChanging] = useState(false)
  const [modelError, setModelError] = useState('')
  if (!data) return null
  const changeModel = async (model: string) => {
    if (!model.trim()) return
    setModelError('')
    try {
      await api('assistant/provider', { method: 'PATCH', json: { model } })
      await qc.invalidateQueries({ queryKey: ['provider'] })
    } catch (e) {
      setModelError((e as Error).message)
    }
  }
  const remove = async () => {
    await api('assistant/provider', { method: 'DELETE' })
    await qc.invalidateQueries({ queryKey: ['provider'] })
    location.reload()
  }
  return (
    <div className="my-1 flex flex-col gap-2">
      {data.connected ? (
        <p className="text-xs text-ink-soft">{t('Сервис')}: {data.label}{data.keyEnding ? `, ${t('ключ')} …${data.keyEnding}` : ''}{data.source === 'server' ? `. ${t('Ключ уже настроен')}` : ''}</p>
      ) : <p className="text-xs text-destructive">{t('Ключ не задан: ассистент не может отвечать')}</p>}
      {data.source === 'app' && !changing && <ModelSelect key={data.provider} presetId={data.provider as PresetId} value={data.model ?? ''} onChange={changeModel} />}
      {modelError && <p role="alert" className="text-xs text-destructive">{modelError}</p>}
      {data.source !== 'server' && (changing || !data.connected ? <ProviderForm onDone={() => setChanging(false)} /> : (
        <div className="flex gap-3 text-xs">
          <button type="button" className="bar-btn border border-border" onClick={() => setChanging(true)}>{t('Сменить ключ')}</button>
          <button type="button" className="bar-btn border border-border" onClick={remove}>{t('Удалить ключ')}</button>
        </div>
      ))}
    </div>
  )
}

/** The built-in assistant: off until the owner connects a provider. */
export function AssistantSettings() {
  const { t } = useApp()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api<{ assistantEnabled: boolean; assistantForReaders: boolean; assistantProvider: string | null; assistantModel: string | null }>('settings') })
  if (!data) return null
  const set = async (key: string, on: boolean) => {
    await api('settings', { method: 'PATCH', json: { [key]: on ? '1' : '0' } })
    await qc.invalidateQueries({ queryKey: ['settings'] })
    location.reload()
  }
  const row = (key: 'assistantEnabled' | 'assistantForReaders', label: string, off = false) => (
    <label className="flex items-center gap-2 min-h-7"><input type="checkbox" className="accent-[var(--ink)] size-4" disabled={off} checked={data[key]} onChange={(e) => set(key, e.target.checked)} /> {t(label)}</label>
  )
  return (
    <section className="flex flex-col gap-2 text-sm">
      <p className="text-xs text-ink-soft">{t('Чат внутри приложения: отвечает на вопросы о семье и вносит правки с вашего подтверждения.')}</p>
      <ProviderSettings />
      {row('assistantEnabled', 'Включить ассистента')}
      {row('assistantForReaders', 'Разрешить читателям пользоваться ассистентом', !data.assistantEnabled)}
    </section>
  )
}
