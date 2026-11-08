'use client'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useApp } from '@/lib/client'
import { SetupGuide } from './settings/setup-guide'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FeatureGuide, type GuideSection } from './feature-guide'

/** Right after the archive is made. Nothing here is required, and it all stays in the settings. */
export function Onboarding({ onClose, onImport, onFirstPerson, onGo }: { onClose: () => void; onImport: () => void; onFirstPerson: () => void; onGo: (section: GuideSection) => void }) {
  const { t } = useApp()
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="flex max-h-[calc(100dvh-32px)] max-w-2xl flex-col gap-3 overflow-auto sm:max-w-2xl">
        <DialogTitle className="font-serif text-xl font-medium">{t('Архив создан. Что дальше?')}</DialogTitle>
        <p className="text-sm text-ink-soft">{t('Обязательного здесь ничего нет. Всё это можно сделать потом: Настройки → Настройка.')}</p>
        <Tabs defaultValue="next" className="flex shrink-0 flex-col gap-3">
          <TabsList className="self-start bg-muted">
            <TabsTrigger value="next">{t('Что дальше')}</TabsTrigger>
            <TabsTrigger value="features">{t('Что умеет приложение')}</TabsTrigger>
          </TabsList>
          <TabsContent value="next"><SetupGuide onImport={onImport} onFirstPerson={onFirstPerson} /></TabsContent>
          <TabsContent value="features"><FeatureGuide onGo={onGo} /></TabsContent>
        </Tabs>
        <Button type="button" className="shrink-0 self-start" onClick={onClose}>{t('Перейти к архиву')}</Button>
      </DialogContent>
    </Dialog>
  )
}
