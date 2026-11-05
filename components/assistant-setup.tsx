'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { PRESETS, type PresetId } from '@/lib/agent/presets'
import { api, useApp } from '@/lib/client'
import type { AssistantState } from '@/lib/types'
import { PanelEdge } from './panel-size'

export interface ProviderStatus { connected: boolean; provider: PresetId | 'local' | null; label: string | null; model: string | null; source: 'server' | 'app' | null; keyEnding: string | null }
export const useProviderStatus = () => useQuery({ queryKey: ['provider'], queryFn: () => api<ProviderStatus>('assistant/provider') })

const CUSTOM = '__custom'

/** The provider's cheap models, cheapest good one first; any other can be typed in. */
export function ModelSelect({ presetId, value, onChange }: { presetId: PresetId; value: string; onChange: (model: string) => void }) {
  const { t } = useApp()
  const { models } = PRESETS.find((p) => p.id === presetId)!
  const listed = !value || models.some((m) => m.id === value)
  const [custom, setCustom] = useState(!listed)
  const current = models.find((m) => m.id === (value || models[0].id))
  return (
    <label className="flex flex-col gap-1 text-xs text-ink-soft">
      {t('Нейросеть')}
      <select aria-label={t('Нейросеть')} className="h-9 w-full rounded-lg border border-input bg-white px-2 text-sm text-ink" value={custom ? CUSTOM : value || models[0].id} onChange={(e) => { const c = e.target.value === CUSTOM; setCustom(c); onChange(c ? '' : e.target.value) }}>
        {models.map((m) => <option key={m.id} value={m.id}>{m.label}, {m.price}</option>)}
        <option value={CUSTOM}>{t('Другая нейросеть…')}</option>
      </select>
      {custom && <input aria-label={t('Название нейросети')} placeholder={t('Название нейросети')} className="h-9 w-full rounded-lg border border-input bg-white px-2 font-mono text-ink" value={value} onChange={(e) => onChange(e.target.value)} />}
      {!custom && current?.note && <span>{t(current.note)}</span>}
      <span className="text-ink-faint">{t('Цена примерно за тысячу страниц текста: ваш вопрос / ответ нейросети')}</span>
    </label>
  )
}

/** Choose a provider, make a key there, paste it here. */
export function ProviderForm({ onDone }: { onDone?: () => void }) {
  const { t } = useApp()
  const qc = useQueryClient()
  const router = useRouter()
  const [id, setId] = useState<PresetId>('openrouter')
  const [key, setKey] = useState('')
  const [model, setModel] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const preset = PRESETS.find((p) => p.id === id)!
  const connect = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('assistant/provider', { method: 'PUT', json: { provider: id, key, ...(model.trim() ? { model: model.trim() } : {}) } })
      setKey('')
      await qc.invalidateQueries({ queryKey: ['provider'] })
      await qc.invalidateQueries({ queryKey: ['settings'] })
      router.refresh()
      onDone?.()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="flex flex-col gap-3 text-sm" onSubmit={connect}>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-xs text-ink-soft">{t('Выберите сервис')}</legend>
        {PRESETS.map((p) => (
          <label key={p.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 ${p.id === id ? 'border-ink bg-white' : 'border-border'}`}>
            <input type="radio" name="provider" className="mt-0.5 accent-[var(--ink)]" checked={p.id === id} onChange={() => { setId(p.id); setError(''); setModel('') }} />
            <span className="min-w-0"><span className="block font-medium">{p.label}</span>{p.pitch && <span className="block text-xs text-ink-soft">{t(p.pitch)}</span>}</span>
          </label>
        ))}
      </fieldset>
      <ol className="flex flex-col gap-2">
        <li><span className="text-ink-soft">1.</span> <a className="inline-flex items-center gap-1 underline" href={preset.keysUrl} target="_blank" rel="noreferrer noopener">{t('Откройте страницу ключей')} {preset.label} <ExternalLink size={12} /></a></li>
        <li><span className="text-ink-soft">2.</span> {t(preset.howTo)}</li>
        <li className="flex flex-col gap-1.5"><span><span className="text-ink-soft">3.</span> {t('Скопируйте ключ и вставьте его сюда')}</span>
          <input type="password" autoComplete="off" spellCheck={false} aria-label={t('Ключ')} placeholder={t('Ключ')} className="h-9 w-full rounded-lg border border-input bg-white px-3 font-mono text-xs" value={key} onChange={(e) => { setKey(e.target.value); setError('') }} />
        </li>
      </ol>
      <details>
        <summary className="cursor-pointer text-ink-soft">{t('Выбрать другую нейросеть')}</summary>
        <div className="mt-2"><ModelSelect presetId={id} value={model} onChange={setModel} /></div>
      </details>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <button className="h-9 rounded-lg bg-ink px-3 text-white disabled:opacity-50" disabled={busy || key.trim().length < 10}>{t(busy ? 'Проверяю ключ…' : 'Проверить и подключить')}</button>
    </form>
  )
}

/** In place of the chat while the assistant cannot answer: why, and what to do about it. */
export default function AssistantSetup({ state, open, onClose, width, onWidth }: { state: Extract<AssistantState, { ready: false }>; open: boolean; onClose: () => void; width: number; onWidth: (w: number) => void }) {
  const { t } = useApp()
  const router = useRouter()
  const { reason } = state
  const enable = async () => {
    await api('settings', { method: 'PATCH', json: { assistantEnabled: '1' } })
    router.refresh()
  }
  return (
    <aside hidden={!open} aria-label={t('Ассистент')} style={{ width: `min(${width}px, calc(100vw - 24px))` }} className="assistant side-sheet float fixed left-3 top-[60px] bottom-3 z-10 flex flex-col !bg-[#fffdf8] text-sm [&[hidden]]:hidden">
      <PanelEdge width={width} onWidth={onWidth} />
      <header className="flex items-center gap-1 border-b border-border py-1 pl-3 pr-1">
        <h2 className="flex-1 font-serif text-lg font-medium">{t('Ассистент')}</h2>
        <button className="bar-btn" title={t('Закрыть')} aria-label={t('Закрыть')} onClick={onClose}><X size={15} /></button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {reason === 'no-key' && !state.canFix && <p>{t('Ассистент ещё не подключён. Подключить его может владелец архива.')}</p>}
        {reason === 'readers' && <p>{t('Владелец архива пока не разрешил ассистента читателям.')}</p>}
        {reason === 'off' && !state.canFix && <p>{t('Владелец архива выключил ассистента.')}</p>}
        {reason === 'off' && state.canFix && (
          <>
            <p>{t('Ассистент выключен. Включите его, чтобы задавать вопросы о семье.')}</p>
            <button className="h-9 rounded-lg bg-ink px-3 text-white" onClick={enable}>{t('Включить ассистента')}</button>
          </>
        )}
        {reason === 'no-key' && state.canFix && (
          <>
            <div>
              <h3 className="text-base font-medium mb-1">{t('Подключите ассистента')}</h3>
              <p className="text-xs text-ink-soft">{t('Ассистенту нужен ключ от сервиса нейросетей. Настройка займёт пару минут, делать её нужно один раз.')}</p>
            </div>
            <ProviderForm />
          </>
        )}
      </div>
    </aside>
  )
}
