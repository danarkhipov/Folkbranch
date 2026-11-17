'use client'
import { ImportDialog } from '../import-dialog'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DatabaseBackup, Download, FileText, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/ui/section'
import { SwitchRow } from '@/components/ui/switch'
import { api, useApp } from '@/lib/client'
import { KinshipCase } from './kinship-case'
import { RestoreForm } from './restore-form'

interface BackupStatus { on: boolean; last: number | null; count: number; bytes: number; keep: number; problem: 'disk' | 'failed' | null }

/** The server's own daily copies: when the last one was made, and what they are good for. */
function DailyCopies() {
  const { t, lang } = useApp()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['backups'], queryFn: () => api<BackupStatus>('backups/status') })
  const [busy, setBusy] = useState(false)
  if (!data) return null
  const when = data.last ? new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(data.last) : null
  const mb = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(data.bytes / 1024 / 1024)
  return (
    <Section title={t('Копии на сервере')} description={t('Сервер сам копирует базу раз в день и хранит последние копии. Это защита от ошибок и неудачных обновлений. От поломки диска защитит только полная копия, сохранённая у вас.')}>
      {!data.on && <p className="text-xs text-ink-soft">{t('Ежедневные копии выключены настройкой сервера.')}</p>}
      {data.problem === 'disk' && <p role="alert" className="text-xs text-destructive">{t('Копия не сделана: на диске почти не осталось места.')}</p>}
      {data.problem === 'failed' && <p role="alert" className="text-xs text-destructive">{t('Последняя копия не получилась. Подробности в журнале сервера.')}</p>}
      <p className="text-sm">{when ? `${t('Последняя копия')}: ${when}, ${mb} ${t('МБ')}. ${t('Хранится копий')}: ${data.count} ${t('из')} ${data.keep}.` : t('Копий ещё нет. Первая появится через несколько минут после запуска.')}</p>
      <Button variant="outline" className="self-start" disabled={busy} onClick={async () => { setBusy(true); try { qc.setQueryData(['backups'], await api<BackupStatus>('backups/now', { method: 'POST' })) } finally { setBusy(false) } }}><DatabaseBackup /> {t(busy ? 'Копирую…' : 'Сделать копию сейчас')}</Button>
    </Section>
  )
}

export function Files({ onText }: { onText: () => void }) {
  const { t, canEdit, me } = useApp()
  const [hide, setHide] = useState(true)
  const [importing, setImporting] = useState(false)
  const { data: voices } = useQuery({ queryKey: ['stories', 'usage'], queryFn: () => api<{ used: number; limit: number }>('stories/usage'), enabled: me.role === 'owner' })
  const mb = (n: number) => Math.ceil(n / 1024 / 1024)
  return (
    <div className="flex min-w-0 flex-col gap-7 text-sm">
      <WhereDataLives />
      {me.role === 'owner' && <DailyCopies />}
      {me.role === 'owner' && (
        <Section title={t('Полная копия архива')} description={t('Все люди, биографии, фото и история в одном файле. Храните его как семейные документы: в нём есть данные живых родственников. Ключи к сервисам ИИ и способам входа в копию не входят: после восстановления их добавляют заново.')}>
            <Button asChild variant="outline" className="self-start"><a href="/api/archive"><Download /> {t('Скачать полную копию')}</a></Button>
        </Section>
      )}
      {canEdit && (
        <Section title={t('Добавить людей из файла')} description={t('Подойдёт таблица или файл .ged из программы для родословных. Перед добавлением покажем, что изменится. Файл можно просто перетащить на схему.')}>
          <Button variant="outline" className="self-start" onClick={() => setImporting(true)}><Upload /> {t('Выбрать файл')}</Button>
          <ImportDialog open={importing} onOpenChange={setImporting} />
        </Section>
      )}
      <Section title={t('Скачать файл для других программ')} description={t('Файл .ged открывается в программах для родословных. В него входят люди и связи, но не биографии и фотографии.')}>
        {me.role !== 'reader' && <SwitchRow title={t('Скрыть живых родственников')} description={t('Они не попадут в файл.')} checked={hide} onChange={setHide} />}
        <Button asChild variant="outline" className="self-start"><a href={`/api/v1/gedcom/export?living=${hide ? 'hide' : 'show'}`}><Download /> {t('Скачать файл .ged')}</a></Button>
      </Section>
      <Section title={t('Схема текстом')} description={t('Вся схема как простой текст: удобно посмотреть, скопировать или дописать сразу много людей.')}>
        <Button variant="outline" className="self-start" onClick={onText}><FileText /> {t('Открыть текст')}</Button>
      </Section>
      {canEdit && <KinshipCase />}
      {me.role === 'owner' && (
        <>
          {voices && (
        <Section title={t('Записи голоса')}>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-ink" style={{ width: `${Math.min(100, (voices.used / voices.limit) * 100)}%` }} /></div>
          <p className="text-xs text-ink-soft">{t('Занято')} {mb(voices.used)} {t('МБ из')} {mb(voices.limit)} {t('МБ')}.</p>
        </Section>
          )}
          <Section danger title={t('Восстановить из копии')} description={t('Заменяет весь текущий архив. Перед этим мы ещё раз спросим.')}>
            <RestoreForm t={t} warning={t('Текущий архив будет заменён содержимым файла. Прежний сохранится на сервере в папке backups, но в приложении вернуть его нельзя.')} />
          </Section>
        </>
      )}
    </div>
  )
}

/** Where each kind of data lives, how long, and what happens with time: only what the code does, checked against it. */
function WhereDataLives() {
  const { t } = useApp()
  const items: [string, string][] = [
    ['Архив', 'Люди, связи, биографии, фото, рассказы и история хранятся на вашем сервере, в папке данных. Наружу они уходят только в сервис ИИ, который вы подключили, и только то, что он читает.'],
    ['История правок', 'Каждая правка записывается навсегда, с тем, кто её сделал: человек, ассистент от его имени или программа по токену MCP. Правку можно отменить, если ту же запись потом не меняли.'],
    ['Программы по MCP', 'Работают только с токеном. Правки по токену с проверкой ждут вас в «Проверке» и до одобрения не меняют архив.'],
    ['Разговоры с ассистентом', 'Текст разговоров хранится только в этом браузере, последние 20. Если очистить браузер или зайти с другого устройства, их не будет. Правки, сделанные в разговоре, остаются в истории.'],
    ['Настройки и ключи', 'Хранятся в базе на сервере, ключи зашифрованы. Изменения настроек в историю не пишутся: их сохраняют ежедневные копии. В полную копию архива ключи не входят.'],
    ['Расход ИИ', 'Запросы, токены и минуты считаются по месяцам и остаются в базе.'],
    ['Если не обновлять приложение', 'Архив продолжит работать как есть. Если сервис уберёт модель ассистента или распознавания речи, приложение само возьмёт другую проверенную (кроме модели, заданной в настройках сервера). Изменения в сервисах распознавания лиц или способах входа могут потребовать обновления. Условия и цены сервисов со временем меняются: смотрите их страницы. При обновлении из приложения сначала делается копия базы.'],
  ]
  return (
    <Section title={t('Что где хранится')}>
      <dl className="flex flex-col gap-2 text-xs">
        {items.map(([k, v]) => <div key={k}><dt className="font-medium text-ink">{t(k)}</dt><dd className="text-ink-soft">{t(v)}</dd></div>)}
      </dl>
    </Section>
  )
}
