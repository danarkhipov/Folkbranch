'use client'
import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/ui/section'
import { SwitchRow } from '@/components/ui/switch'
import { useApp } from '@/lib/client'
import { readDevice, type Device, type Tier } from '@/lib/smart/device'
import { useSmart } from '@/lib/smart/settings'
import { forgetModels, speechPlan } from '@/lib/smart/speech'

const TIER: Record<Tier, string> = { weak: 'Слабое устройство: включайте то, что нужно, работать будет медленнее', normal: 'Обычное устройство: всё будет работать, без спешки', strong: 'Мощное устройство: подойдут и более точные модели' }

/** What this device runs by itself. Nothing here starts on its own: each thing runs when someone presses its button. */
export function SmartSettings() {
  const { t, lang, notify } = useApp()
  const [device, setDevice] = useState<Device | null>(null)
  const [plan, setPlan] = useState<Awaited<ReturnType<typeof speechPlan>> | null>(null)
  const [faces, setFaces] = useSmart('faces')
  const [recognize, setRecognize] = useSmart('recognize')
  const [speech, setSpeech] = useSmart('speech')
  useEffect(() => {
    setDevice(readDevice())
    speechPlan(lang).then(setPlan)
  }, [lang])
  const facts = device && [device.cores && `${t('ядер')}: ${device.cores}`, device.memoryGB && `${t('память')}: ${device.memoryGB}${device.memoryGB >= 8 ? '+' : ''} ${t('ГБ')}`, device.saveData && t('включена экономия трафика')].filter(Boolean).join(' · ')
  return (
    <div className="flex flex-col gap-6 text-sm">
      {device && (
        <div className="rounded-lg bg-muted px-3 py-2">
          <p className="font-medium">{t(TIER[device.tier])}</p>
          <p className="text-xs text-ink-soft">{facts}</p>
        </div>
      )}
      <Section title={t('Что включить')} description={t('Настройка действует только на этом устройстве. Модели скачиваются при первом использовании, а фото и голос остаются у вас.')}>
        <SwitchRow title={t('Поиск лиц на фото')} description={`${t('Нагрузка небольшая, скачивается около 1 МБ. Находит лица, чтобы не обводить их вручную.')}`} checked={faces} onChange={(on) => { setFaces(on); if (!on) setRecognize(false) }} />
        <SwitchRow title={t('Узнавание родственников на фото')} description={`${t('Нагрузка средняя, скачивается около 10 МБ. Подсказывает, кто на новом фото, по уже отмеченным лицам. Имя появится, только если вы его подтвердите.')}`} checked={recognize} disabled={!faces} onChange={setRecognize} />
        <SwitchRow title={t('Расшифровка голоса')} description={plan?.engine !== 'chrome' ? `${t('Нагрузка высокая, скачивается около')} ${plan?.model.mb ?? 50} ${t('МБ. Превращает запись рассказа в текст. Приложением можно пользоваться, пока идёт расшифровка.')}` : `${t('Превращает запись рассказа в текст. Сначала пробует распознавание браузера, оно почти не нагружает устройство. Если не выйдет, скачает модель около 50 МБ.')}`} checked={speech} onChange={setSpeech} />
        {device?.tier === 'weak' && (recognize || speech) && <p className="text-xs text-ink-soft">{t('На этом устройстве работа может занять несколько минут и нагреть его. Её можно остановить в любой момент.')}</p>}
      </Section>
      <Section title={t('Загруженные модели')} description={t('Занимают место только в этом браузере. Если удалить, при следующем использовании они скачаются снова. Запоминание лиц тоже удалится.')}>
        <Button variant="outline" className="self-start" onClick={async () => { await forgetModels(); notify(t('Загруженные модели удалены')) }}><Trash2 /> {t('Удалить загруженное')}</Button>
      </Section>
    </div>
  )
}
