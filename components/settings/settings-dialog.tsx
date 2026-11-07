'use client'
import { useState, type ComponentType } from 'react'
import { Cpu, DatabaseBackup, KeyRound, ListChecks, SlidersHorizontal, UserRound, Users } from 'lucide-react'
import { AssistantIcon } from '../assistant-icon'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useApp } from '@/lib/client'
import { Account } from './account'
import { Access } from './access'
import { Archive } from './archive'
import { Files } from './files'
import { AssistantSettings } from './assistant'
import { SetupGuide } from './setup-guide'
import { ShareLinks } from './share-links'
import { SmartSettings } from './smart'
import { TokensTab } from './tokens'

type Section = 'setup' | 'account' | 'smart' | 'general' | 'people' | 'assistant' | 'agents' | 'data'

/** Each screen says what it is for, so nobody has to work it out from the fields. */
const SECTIONS: Record<Section, [string, string, ComponentType<{ size?: number }>]> = {
  setup: ['С чего начать', 'Что уже готово и что ещё можно подключить. Всё необязательное можно пропустить.', ListChecks],
  account: ['Мой аккаунт', 'Как вы связаны с архивом и как входите в него.', UserRound],
  smart: ['Умные функции', 'Нейросети, которые работают прямо на этом устройстве. Скачайте то, что нужно: остальное приложение работает и без них.', Cpu],
  general: ['Общие параметры', 'Название архива и язык приложения. Меняются сразу для всех.', SlidersHorizontal],
  people: ['Пользователи и доступ', 'Кто входит в архив и что может в нём делать, а кому хватит ссылки для просмотра.', Users],
  assistant: ['ИИ-ассистент', 'Чат внутри приложения: отвечает на вопросы о семье и вносит правки с вашего подтверждения.', AssistantIcon],
  agents: ['Агенты и MCP', 'Подключите Claude, Codex или другую программу: она сможет читать архив и предлагать правки.', KeyRound],
  data: ['Данные и резервные копии', 'Добавить людей из файла, скачать данные, сделать копию архива.', DatabaseBackup],
}

export function SettingsDialog({ open, onOpenChange, familyName, providers, onText }: { open: boolean; onOpenChange: (v: boolean) => void; familyName: string; providers: { google: boolean; yandex: boolean }; onText: () => void }) {
  const { t, me, lang } = useApp()
  const isOwner = me.role === 'owner'
  const [section, setSection] = useState<Section>(isOwner ? 'setup' : 'account')
  const groups: [string, Section[]][] = isOwner
    ? [['', ['setup', 'account']], ['Основные настройки', ['general', 'people', 'data']], ['ИИ и интеграции', ['assistant', 'agents', 'smart']]]
    : [['', ['account', 'smart', 'data']]]
  const [title, description] = SECTIONS[section]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(680px,calc(100dvh-32px))] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav aria-label={t('Настройки')} className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-border p-2 sm:w-[268px] sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r sm:bg-muted/40">
            <DialogTitle className="hidden px-2.5 pt-1.5 pb-3 font-serif text-lg font-medium sm:block">{t('Настройки')}</DialogTitle>
            {groups.map(([group, ids]) => (
              <div key={group} className={group ? 'contents sm:mt-4 sm:block sm:border-t sm:border-[#d9d0bd] sm:pt-3.5' : 'contents sm:block'}>
                {group && <div className="hidden px-2.5 pb-1.5 font-serif text-sm font-semibold text-ink sm:block">{t(group)}</div>}
                {ids.map((id) => {
                  const Icon = SECTIONS[id][2]
                  return <button key={id} className={`settings-item flex shrink-0 items-center gap-2 rounded-lg px-2.5 min-h-[34px] whitespace-nowrap text-left text-sm sm:w-full ${section === id ? 'on bg-muted font-medium text-ink' : 'text-[#5a5245] hover:bg-muted/60 hover:text-ink'}`} aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}><span className="flex-none"><Icon size={15} /></span> {t(SECTIONS[id][0])}</button>
                })}
              </div>
            ))}
          </nav>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
            <header className="mb-5 pr-6">
              <h2 className="font-serif text-xl font-medium">{t(title)}</h2>
              <DialogDescription className="mt-0.5 text-sm text-ink-soft">{t(description)}</DialogDescription>
            </header>
            {section === 'setup' && isOwner && <SetupGuide onGo={setSection} />}
            {section === 'account' && <Account providers={providers} />}
            {section === 'smart' && <SmartSettings />}
            {section === 'general' && isOwner && <Archive familyName={familyName} lang={lang} />}
            {section === 'people' && isOwner && <div className="flex min-w-0 flex-col gap-7"><Access /><ShareLinks /></div>}
            {section === 'assistant' && isOwner && <AssistantSettings />}
            {section === 'agents' && isOwner && <TokensTab />}
            {section === 'data' && <Files onText={() => { onOpenChange(false); onText() }} />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
