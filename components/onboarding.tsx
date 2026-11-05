'use client'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useApp } from '@/lib/client'
import { SetupGuide } from './settings/setup-guide'

/** Right after the archive is made. Nothing here is required, and it all stays in the settings. */
export function Onboarding({ onClose, onImport, onFirstPerson }: { onClose: () => void; onImport: () => void; onFirstPerson: () => void }) {
  const { t } = useApp()
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="flex max-h-[calc(100dvh-32px)] max-w-2xl flex-col gap-3 overflow-auto sm:max-w-2xl">
        <DialogTitle className="font-serif text-xl font-medium">{t('Архив создан. Что дальше?')}</DialogTitle>
        <p className="text-sm text-ink-soft">{t('Обязательного здесь ничего нет. Всё это можно сделать потом: Настройки → Настройка.')}</p>
        <SetupGuide onImport={onImport} onFirstPerson={onFirstPerson} />
        <button type="button" className="h-9 self-start rounded-lg bg-ink px-3 text-sm text-white" onClick={onClose}>{t('Перейти к архиву')}</button>
      </DialogContent>
    </Dialog>
  )
}
