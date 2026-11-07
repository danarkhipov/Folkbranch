'use client'
import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { ModelPrompt } from '../model-prompt'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/ui/section'
import { SwitchRow } from '@/components/ui/switch'
import { useApp } from '@/lib/client'
import { readDevice, type Device, type Tier } from '@/lib/smart/device'
import { packSize, removePack, useModel, type Pack } from '@/lib/smart/models'
import { useSmart, type SmartFeature } from '@/lib/smart/settings'

const TIER: Record<Tier, string> = { weak: 'Слабое устройство: берите только нужное, работать будет медленнее', normal: 'Обычное устройство: всё будет работать, без спешки', strong: 'Мощное устройство: подойдёт и более точная модель голоса' }

function Feature({ feature, title, about, needs }: { feature: SmartFeature & Pack; title: string; about: string; needs?: Pack }) {
  const { t, confirm: ask } = useApp()
  const [on, setOn] = useSmart(feature)
  const m = useModel(feature)
  const base = useModel(needs ?? feature)
  const ready = m.status === 'ready'
  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <SwitchRow title={t(title)} description={t(about)} checked={ready && on} disabled={!ready} onChange={setOn} />
      <ModelPrompt pack={feature} compact />
      {needs && base.status !== 'ready' && m.status === 'none' && <p className="text-xs text-ink-soft">{t('В загрузку входит и поиск лиц.')}</p>}
      {ready && (
        <Button variant="ghost" size="sm" className="self-start" onClick={async () => { if (await ask(`${t('Удалить модель')}: ${t(title)}?`, t('Удалить'), t('Её можно будет скачать снова.'))) removePack(feature) }}>
          <Trash2 /> {t('Удалить модель')}, {packSize(feature)} {t('МБ')}
        </Button>
      )}
    </div>
  )
}

/** What this device runs by itself. Nothing downloads or starts on its own. */
export function SmartSettings() {
  const { t } = useApp()
  const [device, setDevice] = useState<Device | null>(null)
  useEffect(() => { setDevice(readDevice()) }, [])
  const facts = device && [device.cores && `${t('ядер')}: ${device.cores}`, device.memoryGB && `${t('память')}: ${device.memoryGB}${device.memoryGB >= 8 ? '+' : ''} ${t('ГБ')}`, device.saveData && t('включена экономия трафика')].filter(Boolean).join(' · ')
  return (
    <div className="flex flex-col gap-6 text-sm">
      {device && (
        <div className="rounded-lg bg-muted px-3 py-2">
          <p className="font-medium">{t(TIER[device.tier])}</p>
          <p className="text-xs text-ink-soft">{facts}</p>
        </div>
      )}
      <Section title={t('Модели на этом устройстве')} description={t('Ничего не скачивается само. Модели работают в этом браузере, а фото и голос остаются у вас. На другом устройстве модели скачиваются отдельно.')}>
        <div className="flex flex-col gap-3">
          <Feature feature="faces" title="Поиск лиц на фото" about="Находит лица и на старых групповых снимках, чтобы не обводить их вручную. Нагрузка небольшая." />
          <Feature feature="recognize" needs="faces" title="Узнавание родственников на фото" about="Подсказывает, кто на новом фото, по уже отмеченным лицам. Имя появится, только если вы его подтвердите. Нагрузка небольшая." />
          <Feature feature="speech" title="Расшифровка голоса" about="Превращает запись рассказа в текст и позволяет говорить с ассистентом голосом. Нагрузка высокая, пока идёт расшифровка, а приложением можно пользоваться." />
        </div>
      </Section>
    </div>
  )
}
