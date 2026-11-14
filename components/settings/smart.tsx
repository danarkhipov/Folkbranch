'use client'
import { useEffect, useState } from 'react'
import { Check, Download, Square, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/ui/section'
import { SwitchRow } from '@/components/ui/switch'
import { useApp } from '@/lib/client'
import { readDevice, type Device, type Tier } from '@/lib/smart/device'
import { cancelVariant, choose, downloadVariant, recommended, removeVariant, useChosen, useVariant, variantSize, variantsFor, type Pack, type Variant } from '@/lib/smart/models'
import { useSmart } from '@/lib/smart/settings'
import { useCloud } from '@/lib/smart/cloud'

const TIER: Record<Tier, string> = { weak: 'Слабое устройство: берите только нужное, работать будет медленнее', normal: 'Обычное устройство: всё будет работать, без спешки', strong: 'Мощное устройство: подойдут и самые точные модели' }
const mb = (n: number) => Math.ceil(n / 1024 / 1024)

function ModelRow({ v, inUse, only }: { v: Variant; inUse: boolean; only: boolean }) {
  const { t, confirm: ask } = useApp()
  const m = useVariant(v.id)
  const ready = m.status === 'ready'
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 rounded-lg border p-2.5 ${inUse && ready ? 'border-ink' : 'border-border'}`}>
      <div className="flex flex-wrap items-center gap-x-2">
        <span className="font-medium">{t(v.name)}</span>
        {recommended(v) && !only && <span className="text-xs text-ink-soft">{t('Рекомендуем для этого устройства')}</span>}
      </div>
      <p className="text-xs leading-snug text-ink-soft">{t(v.facts)}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {m.status === 'busy' && (
          <div className="flex min-w-48 flex-1 items-center gap-2" role="status">
            <div className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-input"><div className="h-full bg-ink transition-[width]" style={{ width: `${m.total ? Math.min(100, (m.loaded / m.total) * 100) : 4}%` }} /></div>
            <span className="text-xs tabular-nums text-ink-soft">{m.total ? `${mb(m.loaded)} ${t('из')} ${mb(m.total)} ${t('МБ')}` : t('Готовлюсь…')}</span>
            <Button variant="ghost" size="sm" onClick={() => cancelVariant(v.id)}><Square /> {t('Остановить')}</Button>
          </div>
        )}
        {m.status === 'none' && <Button variant="outline" size="sm" onClick={() => downloadVariant(v.id)}><Download /> {t('Скачать модель')}, {variantSize(v.id)} {t('МБ')}</Button>}
        {ready && !only && (inUse ? <span className="flex items-center gap-1 pr-1 text-xs"><Check size={13} /> {t('Используется')}</span> : <Button variant="outline" size="sm" onClick={() => choose(v.id)}>{t('Использовать')}</Button>)}
        {ready && <Button variant="ghost" size="sm" onClick={async () => { if (await ask(t('Удалить модель: {name}?').replace('{name}', () => t(v.name)), t('Удалить'), t('Её можно будет скачать снова.'))) removeVariant(v.id) }}><Trash2 /> {t('Удалить модель')}, {variantSize(v.id)} {t('МБ')}</Button>}
        {m.status === 'unavailable' && <span className="text-xs text-ink-soft">{t('Модели можно скачать только по защищённому адресу (https) или на этом компьютере.')}</span>}
      </div>
      {m.failed && <p role="alert" className="text-xs text-destructive">{t('Не удалось скачать модель. Проверьте соединение и попробуйте ещё раз.')}</p>}
    </div>
  )
}

function Feature({ feature, title, about }: { feature: Pack; title: string; about: string }) {
  const { t } = useApp()
  const [on, setOn] = useSmart(feature)
  const current = useChosen(feature)
  const list = variantsFor(feature)
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <SwitchRow title={t(title)} description={t(about)} checked={on} onChange={setOn} />
      {on && <div className="flex flex-col gap-1.5">{list.map((v) => <ModelRow key={v.id} v={v} inUse={v.id === current.id} only={list.length === 1} />)}</div>}
    </div>
  )
}

/** What this device runs by itself. Nothing downloads or starts on its own. */
export function SmartSettings() {
  const { t } = useApp()
  const cloud = useCloud()
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
      {cloud.enabled && (
        <Section title={t('Расшифровка в облаке')} description={t('Владелец архива подключил сервис распознавания речи и платит за него сам. Скачивать ничего не нужно, работает на любом устройстве и обычно точнее.')}>
          <SwitchRow title={t('Расшифровывать в облаке на этом устройстве')} description={`${t('Запись уйдёт на сервер архива и дальше в')} ${cloud.info?.where}. ${t('Если выключено, голос остаётся на устройстве и читается моделью ниже.')}`} checked={cloud.chosen} onChange={cloud.set} />
        </Section>
      )}
      <Section title={t('Модели на этом устройстве')} description={t('Ничего не скачивается само. Модели работают в этом браузере, а фото и голос остаются у вас. На другом устройстве модели скачиваются отдельно.')}>
        <div className="flex flex-col gap-4">
          <Feature feature="faces" title="Поиск лиц на фото" about="Находит лица и на старых групповых снимках, чтобы не обводить их вручную." />
          <Feature feature="recognize" title="Узнавание родственников на фото" about="Подсказывает, кто на новом фото, по уже отмеченным лицам. Имя появится, только если вы его подтвердите." />
          <Feature feature="speech" title="Расшифровка голоса" about="Превращает запись рассказа в текст и позволяет говорить с ассистентом голосом. Пока идёт расшифровка, приложением можно пользоваться." />
        </div>
        <p className="text-xs text-ink-soft">{t('Цифры из наших замеров на старых снимках и русских записях, на компьютере с 12 ядрами. На вашем устройстве скорость будет другой.')}</p>
      </Section>
    </div>
  )
}
