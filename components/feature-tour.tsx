'use client'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useApp } from '@/lib/client'
import { FeatureGuide, type GuideSection } from './feature-guide'

/** Shown once to someone who has just come into the archive, so they know what it can do. It is always in the settings too. */
export function FeatureTour({ onClose, onGo }: { onClose: () => void; onGo: (section: GuideSection) => void }) {
  const { t } = useApp()
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="flex max-h-[calc(100dvh-32px)] max-w-2xl flex-col gap-3 overflow-y-auto sm:max-w-2xl">
        <DialogTitle className="font-serif text-xl font-medium">{t('Добро пожаловать в семейный архив')}</DialogTitle>
        <DialogDescription className="text-sm text-ink-soft">{t('Коротко о том, что здесь можно делать. Это всегда можно открыть снова: Настройки → Возможности и советы.')}</DialogDescription>
        <FeatureGuide onGo={onGo} />
        <Button type="button" className="shrink-0 self-start" onClick={onClose}>{t('Понятно')}</Button>
      </DialogContent>
    </Dialog>
  )
}
