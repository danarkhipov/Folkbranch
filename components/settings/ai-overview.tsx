'use client'
import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { List, ListRow, Section } from '@/components/ui/section'
import { api, useApp } from '@/lib/client'
import type { AiSettingsFile } from '@/lib/ops/ai-config'
import { applyChoices, chosen, currentChoices, type Pack } from '@/lib/smart/models'
import { sttPreset } from '@/lib/transcribe/presets'
import type { Section as Screen } from './settings-dialog'

interface Applied { applied: string[]; skipped: { what: string; why: string }[]; onDevice: Partial<Record<Pack, string>> | null }

/** Everything about the AI at a glance, and one file for all of it. Each line opens the screen where it is set. */
export function AiOverview({ onGo }: { onGo: (to: Screen) => void }) {
  const { t, notify } = useApp()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['ai-settings'], queryFn: () => api<AiSettingsFile>('ai-settings') })
  const [result, setResult] = useState<Applied | null>(null)
  const pick = useRef<HTMLInputElement>(null)

  const assistant = data?.assistant
  const speech = data?.speech
  const speechName = speech ? `${sttPreset(speech.provider as never)?.label ?? speech.provider}${speech.model && speech.model !== 'auto' ? `, ${speech.model}` : ''}` : null

  const download = () => {
    if (!data) return
    const file: AiSettingsFile = { ...data, onDevice: currentChoices() }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }))
    a.download = 'folkbranch-ai-settings.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const upload = async (file: File) => {
    try {
      const out = await api<Applied>('ai-settings', { method: 'PUT', json: JSON.parse(await file.text()) })
      const device = out.onDevice ? applyChoices(out.onDevice) : []
      setResult({ ...out, applied: [...out.applied, ...(device.length ? [t('Лица и голос на этом устройстве')] : [])] })
      await qc.invalidateQueries()
    } catch (e) {
      notify(e instanceof SyntaxError ? t('Это не файл настроек ИИ приложения') : (e as Error).message)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-7">
      <Section title={t('Что подключено')} description={t('Четыре места, где живёт ИИ. Нажмите на строку, чтобы изменить.')}>
        <List>
          <ListRow
            title={t('Ассистент')}
            meta={!data ? '…' : assistant?.provider ? `${assistant.enabled ? t('включён') : t('выключен')} · ${assistant.provider}${assistant.model ? ` · ${assistant.model === 'auto' ? t('сам берёт новую модель') : assistant.model}` : ''}` : t('не подключён')}
            actions={<Button type="button" variant="outline" size="sm" onClick={() => onGo('assistant')}>{t('Настроить')}</Button>}
          />
          <ListRow
            title={t('Расшифровка в облаке')}
            meta={!data ? '…' : speechName ?? t('не подключена: записи расшифровывает само устройство')}
            actions={<Button type="button" variant="outline" size="sm" onClick={() => onGo('speech')}>{t('Настроить')}</Button>}
          />
          <ListRow
            title={t('Лица и голос на этом устройстве')}
            meta={`${chosen('faces').name} · ${chosen('recognize').name} · ${chosen('speech').name}`}
            actions={<Button type="button" variant="outline" size="sm" onClick={() => onGo('smart')}>{t('Настроить')}</Button>}
          />
          <ListRow
            title={t('Рассказы по ссылке')}
            meta={t('Родные надиктовывают историю по ссылке, она ложится к нужному человеку. Расшифровывает облако, если оно подключено, иначе устройство того, кто разбирает запись.')}
            actions={<Button type="button" variant="outline" size="sm" onClick={() => onGo('people')}>{t('Ссылки')}</Button>}
          />
        </List>
      </Section>
      <Section title={t('Файл настроек')} description={t('Всё, что выбрано выше, в одном файле. Ключей в нём нет: они остаются на сервере. Файл можно загрузить в другом архиве, чтобы настроить его так же.')}>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={!data} onClick={download}><Download /> {t('Скачать файл настроек')}</Button>
          <Button type="button" variant="outline" onClick={() => pick.current?.click()}><Upload /> {t('Загрузить файл настроек')}</Button>
          <input ref={pick} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f) }} />
        </div>
        {result && (
          <div role="status" className="flex flex-col gap-1 text-sm">
            {result.applied.length > 0 && <p>{t('Применено')}: {result.applied.join(', ')}.</p>}
            {result.skipped.map((s) => <p key={s.what} className="text-destructive break-anywhere">{s.what}: {s.why}</p>)}
            {!result.applied.length && !result.skipped.length && <p>{t('В файле нечего менять.')}</p>}
          </div>
        )}
      </Section>
    </div>
  )
}
