'use client'
import { ImportDialog } from '../import-dialog'
import { useState } from 'react'
import { Download, FileText, Upload } from 'lucide-react'
import { useApp } from '@/lib/client'
import { RestoreForm } from './restore-form'

export function Files({ onText }: { onText: () => void }) {
  const { t, canEdit, me } = useApp()
  const [hide, setHide] = useState(true)
  const [importing, setImporting] = useState(false)
  return (
    <div className="flex flex-col gap-5 text-sm">
      {canEdit && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-base font-medium">{t('Добавить людей из файла')}</h3>
          <p className="text-xs text-ink-soft">{t('Подойдёт таблица или файл .ged из программы для родословных. Перед добавлением покажем, что изменится. Файл можно просто перетащить на схему.')}</p>
          <button className="bar-btn self-start border border-border" onClick={() => setImporting(true)}><Upload size={14} /> {t('Выбрать файл')}</button>
          <ImportDialog open={importing} onOpenChange={setImporting} />
        </section>
      )}
      <section className="flex flex-col gap-1.5">
        <h3 className="text-base font-medium">{t('Скачать файл для других программ')}</h3>
        <p className="text-xs text-ink-soft">{t('Файл .ged открывается в программах для родословных. В него входят люди и связи, но не биографии и фотографии.')}</p>
        {me.role !== 'reader' && <label className="flex items-center gap-2 text-ink"><input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} /> {t('Не включать живых родственников в файл')}</label>}
        <a className="bar-btn self-start border border-border" href={`/api/v1/gedcom/export?living=${hide ? 'hide' : 'show'}`}><Download size={14} /> {t('Скачать файл')}</a>
      </section>
      {me.role === 'owner' && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-base font-medium">{t('Полная копия архива')}</h3>
          <p className="text-xs text-ink-soft">{t('Все люди, биографии, фото и история в одном файле. Храните его как семейные документы: в нём есть данные живых родственников.')}</p>
          <a className="bar-btn self-start border border-border" href="/api/archive"><Download size={14} /> {t('Скачать полную копию')}</a>
          <p className="text-xs text-ink-soft mt-2">{t('Подключённый ключ ассистента в копию не входит, его нужно будет ввести снова.')}</p>
          <RestoreForm t={t} warning={t('Текущий архив будет заменён содержимым файла. Прежний сохранится на сервере в папке backups, но в приложении вернуть его нельзя.')} />
        </section>
      )}
      <section className="flex flex-col gap-1.5">
        <h3 className="text-base font-medium">{t('Схема текстом')}</h3>
        <p className="text-xs text-ink-soft">{t('Вся схема как простой текст: удобно посмотреть, скопировать или дописать сразу много людей.')}</p>
        <button className="bar-btn self-start border border-border" onClick={onText}><FileText size={14} /> {t('Открыть текст')}</button>
      </section>
    </div>
  )
}
