'use client'
import { Download, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useApp } from '@/lib/client'
import { cancelPack, downloadPack, packSize, useModel, type Pack } from '@/lib/smart/models'

const mb = (n: number) => Math.ceil(n / 1024 / 1024)

/** Where a feature needs a model it does not have yet: says what it gives and what it costs, and fetches it on request. */
export function ModelPrompt({ pack, children, compact }: { pack: Pack; children?: React.ReactNode; compact?: boolean }) {
  const { t } = useApp()
  const m = useModel(pack)
  if (m.status === 'ready' || m.status === 'unknown') return null
  if (m.status === 'unavailable') return <p className="text-xs text-ink-soft">{t('Модели можно скачать только по защищённому адресу (https) или на этом компьютере.')}</p>
  return (
    <div className={compact ? 'flex flex-col gap-1.5' : 'flex flex-col gap-1.5 rounded-lg bg-muted px-3 py-2'}>
      {children && <p className="text-xs text-ink-soft">{children}</p>}
      {m.status === 'busy'
        ? (
          <div className="flex items-center gap-2" role="status">
            <div className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-input"><div className="h-full bg-ink transition-[width]" style={{ width: `${m.total ? Math.min(100, (m.loaded / m.total) * 100) : 4}%` }} /></div>
            <span className="text-xs tabular-nums text-ink-soft">{m.total ? `${mb(m.loaded)} ${t('из')} ${mb(m.total)} ${t('МБ')}` : t('Готовлюсь…')}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => cancelPack(pack)}><Square /> {t('Остановить')}</Button>
          </div>
        )
        : <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => downloadPack(pack)}><Download /> {t('Скачать модель')}, {packSize(pack)} {t('МБ')}</Button>}
      {m.failed && <p role="alert" className="text-xs text-destructive">{t('Не удалось скачать модель. Проверьте соединение и попробуйте ещё раз.')}</p>}
    </div>
  )
}
