'use client'
import { ImportDialog } from '../import-dialog'
import { useState } from 'react'
import { Download, FileText, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/ui/section'
import { SwitchRow } from '@/components/ui/switch'
import { useApp } from '@/lib/client'
import { RestoreForm } from './restore-form'

export function Files({ onText }: { onText: () => void }) {
  const { t, canEdit, me } = useApp()
  const [hide, setHide] = useState(true)
  const [importing, setImporting] = useState(false)
  return (
    <div className="flex min-w-0 flex-col gap-7 text-sm">
      {canEdit && (
        <Section title={t('Добавить людей из файла')} description={t('Подойдёт таблица или файл .ged из программы для родословных. Перед добавлением покажем, что изменится. Файл можно просто перетащить на схему.')}>
          <Button variant="outline" className="self-start" onClick={() => setImporting(true)}><Upload /> {t('Выбрать файл')}</Button>
          <ImportDialog open={importing} onOpenChange={setImporting} />
        </Section>
      )}
      <Section title={t('Скачать файл для других программ')} description={t('Файл .ged открывается в программах для родословных. В него входят люди и связи, но не биографии и фотографии.')}>
        {me.role !== 'reader' && <SwitchRow title={t('Не включать живых родственников в файл')} checked={hide} onChange={setHide} />}
        <Button asChild variant="outline" className="self-start"><a href={`/api/v1/gedcom/export?living=${hide ? 'hide' : 'show'}`}><Download /> {t('Скачать файл')}</a></Button>
      </Section>
      <Section title={t('Схема текстом')} description={t('Вся схема как простой текст: удобно посмотреть, скопировать или дописать сразу много людей.')}>
        <Button variant="outline" className="self-start" onClick={onText}><FileText /> {t('Открыть текст')}</Button>
      </Section>
      {me.role === 'owner' && (
        <>
          <Section title={t('Полная копия архива')} description={t('Все люди, биографии, фото и история в одном файле. Храните его как семейные документы: в нём есть данные живых родственников. Ключ ассистента в копию не входит.')}>
            <Button asChild variant="outline" className="self-start"><a href="/api/archive"><Download /> {t('Скачать полную копию')}</a></Button>
          </Section>
          <Section danger title={t('Восстановить из копии')} description={t('Заменяет весь текущий архив. Перед этим мы ещё раз спросим.')}>
            <RestoreForm t={t} warning={t('Текущий архив будет заменён содержимым файла. Прежний сохранится на сервере в папке backups, но в приложении вернуть его нельзя.')} />
          </Section>
        </>
      )}
    </div>
  )
}
