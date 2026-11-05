'use client'
import { useState } from 'react'
import { Archive as Archive_, ArrowLeftRight, KeyRound, ListChecks, UserRound, Users, type LucideIcon } from 'lucide-react'
import { AssistantIcon } from '../assistant-icon'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useApp } from '@/lib/client'
import { Account } from './account'
import { Access } from './access'
import { Archive } from './archive'
import { Files } from './files'
import { AssistantSettings } from './assistant'
import { SetupGuide } from './setup-guide'
import { TokensTab } from './tokens'

type Section = 'setup' | 'account' | 'people' | 'archive' | 'assistant' | 'agents' | 'data'

export function SettingsDialog({ open, onOpenChange, familyName, providers, onText }: { open: boolean; onOpenChange: (v: boolean) => void; familyName: string; providers: { google: boolean; yandex: boolean }; onText: () => void }) {
  const { t, me, lang } = useApp()
  const isOwner = me.role === 'owner'
  const [section, setSection] = useState<Section>(isOwner ? 'setup' : 'account')
  const items: [Section, string, LucideIcon][] = [
    ...(isOwner ? [['setup', 'Настройка', ListChecks]] as [Section, string, LucideIcon][] : []),
    ['account', 'Мой аккаунт', UserRound],
    ...(isOwner ? [['people', 'Люди и доступ', Users], ['archive', 'Архив', Archive_], ['assistant', 'Ассистент', AssistantIcon]] as [Section, string, LucideIcon][] : []),
    ['data', 'Файлы', ArrowLeftRight],
    ...(isOwner ? [['agents', 'Агенты и MCP', KeyRound]] as [Section, string, LucideIcon][] : []),
  ]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(620px,calc(100dvh-32px))] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogTitle className="border-b border-border px-5 py-3 font-serif text-lg font-medium">{t('Настройки')}</DialogTitle>
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav aria-label={t('Настройки')} className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-border p-2 sm:w-52 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r">
            {items.map(([id, label, Icon]) => (
              <button key={id} className={`flex shrink-0 items-center gap-2 rounded-lg px-2.5 min-h-9 text-left text-sm ${section === id ? 'bg-muted font-medium text-ink' : 'text-ink-soft hover:bg-muted/60'}`} aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}><Icon size={15} /> {t(label)}</button>
            ))}
          </nav>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-4">
            {section === 'setup' && isOwner && <SetupGuide />}
            {section === 'account' && <Account providers={providers} />}
            {section === 'people' && isOwner && <Access />}
            {section === 'archive' && isOwner && <Archive familyName={familyName} lang={lang} />}
            {section === 'assistant' && isOwner && <AssistantSettings />}
            {section === 'agents' && isOwner && <TokensTab />}
            {section === 'data' && <Files onText={() => { onOpenChange(false); onText() }} />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
