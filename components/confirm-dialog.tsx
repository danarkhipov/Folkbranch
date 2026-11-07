'use client'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useApp } from '@/lib/client'

export function ConfirmDialog({ state, onClose }: { state: { text: string; action: string; note?: string; resolve: (v: boolean) => void } | null; onClose: () => void }) {
  const { t } = useApp()
  const done = (v: boolean) => { state?.resolve(v); onClose() }
  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && done(false)}>
      <DialogContent className="max-w-sm" showCloseButton={false}>
        <DialogTitle className="font-serif font-medium text-lg">{state?.text}</DialogTitle>
        {state?.note && <p className="text-sm text-ink-soft">{state.note}</p>}
        <div className="flex justify-end gap-2 mt-2">
          <button className="bar-btn" onClick={() => done(false)}>{t('Отмена')}</button>
          <button className="bar-btn on !bg-destructive" autoFocus onClick={() => done(true)}>{state?.action}</button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
