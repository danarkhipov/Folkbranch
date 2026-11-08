'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/ui/section'
import { SwitchRow } from '@/components/ui/switch'
import { api, useApp } from '@/lib/client'
import { LiveModelSelect, ProviderForm, useProviderStatus } from '../assistant-setup'

/** Which provider answers, and changing it. */
function ProviderSettings() {
  const { t, confirm: ask } = useApp()
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
    if (!await ask(t('Удалить ключ сервиса?'), t('Удалить ключ'), t('Ассистент перестанет отвечать, пока вы не добавите новый.'))) return
    await api('assistant/provider', { method: 'DELETE' })
    await qc.invalidateQueries({ queryKey: ['provider'] })
    location.reload()
  }
  return (
    <Section title={t('Сервис и нейросеть')} description={t('Ассистент работает на вашем ключе: вы платите сервису сами, и то, что ассистент читает, уходит туда.')}>
      {data.connected ? (
        <p className="text-xs text-ink-soft">{t('Сервис')}: {data.label}{data.keyEnding ? `, ${t('ключ')} …${data.keyEnding}` : ''}{data.source === 'server' ? `. ${t('Ключ уже настроен')}` : ''}</p>
      ) : <p className="text-xs text-ink-soft">{t('Сначала подключите ключ: без него ассистент не может отвечать.')}</p>}
      {data.source === 'app' && !changing && data.auto && <p className="text-xs text-ink-soft" role="status">{t('Нейросеть')}: <b className="font-medium text-ink">{data.model}</b>. {t('Выбрана сама: проверенная, а когда выйдет новее в той же линейке, приложение перейдёт на неё без вас.')}</p>}
      {data.source === 'app' && !changing && (
        <details>
          <summary className="cursor-pointer text-xs text-ink-soft">{t('Для опытных: выбрать нейросеть самому')}</summary>
          <div className="mt-2 flex flex-col gap-2">
            <LiveModelSelect key={`${data.provider}:${data.model}`} value={data.model ?? ''} onChange={changeModel} />
            {!data.auto && data.autoPossible && <Button type="button" variant="outline" size="sm" className="self-start" onClick={async () => { await api('assistant/provider', { method: 'PATCH', json: { auto: true } }); await qc.invalidateQueries({ queryKey: ['provider'] }) }}>{t('Снова выбирать автоматически')}</Button>}
          </div>
        </details>
      )}
      {modelError && <p role="alert" className="text-xs text-destructive">{modelError}</p>}
      {data.source !== 'server' && (changing || !data.connected ? <ProviderForm onDone={() => setChanging(false)} /> : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setChanging(true)}><KeyRound /> {t('Сменить ключ')}</Button>
          <Button type="button" variant="danger" onClick={remove}><Trash2 /> {t('Удалить ключ')}</Button>
        </div>
      ))}
    </Section>
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
  return (
    <div className="flex min-w-0 flex-col gap-7 text-sm">
      <Section title={t('Кому доступен')}>
        <SwitchRow title={t('Включить ассистента')} description={t('Появится для редакторов и владельца.')} checked={data.assistantEnabled} onChange={(on) => set('assistantEnabled', on)} />
        <SwitchRow title={t('Разрешить читателям пользоваться ассистентом')} description={t('Читатели смогут спрашивать, но не менять. Живых родственников ассистент им не покажет.')} disabled={!data.assistantEnabled} checked={data.assistantForReaders} onChange={(on) => set('assistantForReaders', on)} />
      </Section>
      <ProviderSettings />
    </div>
  )
}
