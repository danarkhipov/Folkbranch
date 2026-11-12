'use client'
import { useState, type ComponentType } from 'react'
import { AudioLines, ChevronLeft, ChevronRight, Cpu, DatabaseBackup, DoorOpen, KeyRound, Lightbulb, Sparkles, ListChecks, SlidersHorizontal, UserRound, Users } from 'lucide-react'
import { AssistantIcon } from '../assistant-icon'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useApp } from '@/lib/client'
import { cn } from '@/lib/utils'
import { Account } from './account'
import { Access } from './access'
import { Archive } from './archive'
import { Files } from './files'
import { FeatureGuide } from '../feature-guide'
import { CloudSpeech } from './cloud-speech'
import { AiOverview } from './ai-overview'
import { AssistantSettings } from './assistant'
import { SetupGuide } from './setup-guide'
import { ShareLinks } from './share-links'
import { SignInMethods } from './sign-in-methods'
import { SmartSettings } from './smart'
import type { SignInMethods as Methods } from '@/lib/sign-in-methods'
import { TokensTab } from './tokens'

export type Section = 'ai' | 'speech' | 'tips' | 'setup' | 'account' | 'smart' | 'general' | 'people' | 'signin' | 'assistant' | 'agents' | 'data'

/** Each screen says what it is for, so nobody has to work it out from the fields. */
const SECTIONS: Record<Section, [string, string, ComponentType<{ size?: number }>]> = {
  ai: ['ИИ и модели', 'Что подключено: ассистент, расшифровка, лица и голос. И один файл, в котором всё это можно сохранить и загрузить.', Sparkles],
  speech: ['Расшифровка в облаке', 'Один сервис распознавания речи на всех: вы подключаете и платите, редакторы пользуются.', AudioLines],
  tips: ['Возможности и советы', 'Всё, что умеет приложение, и то, что обычно остаётся незамеченным.', Lightbulb],
  setup: ['С чего начать', 'Что уже готово и что ещё можно подключить. Всё необязательное можно пропустить.', ListChecks],
  account: ['Мой аккаунт', 'Как вы связаны с архивом и как входите в него.', UserRound],
  smart: ['Лица и голос', 'Поиск лиц на фото и распознавание речи. Работает прямо на этом устройстве. Скачайте то, что нужно: остальное приложение работает и без этого.', Cpu],
  general: ['Общие параметры', 'Название архива и язык приложения. Меняются сразу для всех.', SlidersHorizontal],
  signin: ['Способы входа', 'Чем родные входят в архив после первой ссылки: Яндекс ID, VK ID, Telegram, Google или код на почту.', DoorOpen],
  people: ['Пользователи и доступ', 'Кто входит в архив и что может в нём делать, а кому хватит ссылки для просмотра.', Users],
  assistant: ['ИИ-ассистент', 'Чат внутри приложения: отвечает на вопросы о семье и вносит правки с вашего подтверждения.', AssistantIcon],
  agents: ['Внешние программы', 'Подключите Claude, Codex или другую программу: она сможет читать архив и предлагать правки. Обычно это не нужно.', KeyRound],
  data: ['Данные и резервные копии', 'Добавить людей из файла, скачать данные, сделать копию архива.', DatabaseBackup],
}

export function SettingsDialog({ open, onOpenChange, familyName, providers, onText, initial }: { open: boolean; onOpenChange: (v: boolean) => void; familyName: string; providers: Methods; onText: () => void; initial?: Section }) {
  const { t, me, lang } = useApp()
  const isOwner = me.role === 'owner'
  const [section, setSectionNow] = useState<Section>(initial ?? (isOwner ? 'setup' : 'account'))
  // On a phone the list and a section take turns on the screen; a row of tabs there hid most of the sections.
  const [inside, setInside] = useState(!!initial)
  const setSection = (next: Section) => { setSectionNow(next); setInside(true) }
  const groups: [string, Section[]][] = isOwner
    ? [['', ['setup', 'tips', 'account']], ['Основные настройки', ['general', 'people', 'signin', 'data']], ['ИИ и интеграции', ['ai', 'assistant', 'speech', 'agents', 'smart']]]
    : [['', ['account', 'tips', 'smart', 'data']]]
  const [title, description] = SECTIONS[section]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(680px,calc(100dvh-32px))] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav aria-label={t('Настройки')} className={cn('flex shrink-0 flex-col gap-0.5 overflow-y-auto p-2 max-sm:min-h-0 max-sm:flex-1 sm:w-[268px] sm:border-r sm:border-border sm:bg-muted/40', inside && 'max-sm:hidden')}>
            <DialogTitle className="px-2.5 pt-1.5 pb-3 font-serif text-lg font-medium">{t('Настройки')}</DialogTitle>
            {groups.map(([group, ids]) => (
              <div key={group} className={group ? 'mt-4 border-t border-[#d9d0bd] pt-3.5' : ''}>
                {group && <div className="px-2.5 pb-1.5 font-serif text-sm font-semibold text-ink">{t(group)}</div>}
                {ids.map((id) => {
                  const Icon = SECTIONS[id][2]
                  return <button key={id} className={`settings-item flex w-full shrink-0 items-center gap-2 rounded-lg px-2.5 min-h-9 max-sm:min-h-11 text-left text-sm ${section === id ? 'on bg-muted font-medium text-ink' : 'text-[#5a5245] hover:bg-muted/60 hover:text-ink'}`} aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}><span className="flex-none"><Icon size={15} /></span> {t(SECTIONS[id][0])}<ChevronRight size={15} className="ml-auto flex-none text-ink-faint sm:hidden" /></button>
                })}
              </div>
            ))}
          </nav>
          <div className={cn('min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6', !inside && 'max-sm:hidden')}>
            <button type="button" className="pick -ml-1 mb-2 flex items-center gap-0.5 text-sm text-ink-soft hover:text-ink min-h-9 sm:hidden" onClick={() => setInside(false)}><ChevronLeft size={16} /> {t('Настройки')}</button>
            <header className="mb-5 pr-6">
              <h2 className="font-serif text-xl font-medium">{t(title)}</h2>
              <DialogDescription className="mt-0.5 text-sm text-ink-soft">{t(description)}</DialogDescription>
            </header>
            {section === 'ai' && isOwner && <AiOverview onGo={setSection} />}
            {section === 'setup' && isOwner && <SetupGuide onGo={setSection} />}
            {section === 'tips' && <FeatureGuide onGo={setSection} />}
            {section === 'account' && <Account providers={providers} />}
            {section === 'smart' && <SmartSettings />}
            {section === 'general' && isOwner && <Archive familyName={familyName} lang={lang} />}
            {section === 'people' && isOwner && <div className="flex min-w-0 flex-col gap-7"><Access /><ShareLinks /></div>}
            {section === 'signin' && isOwner && <SignInMethods />}
            {section === 'speech' && isOwner && <CloudSpeech />}
            {section === 'assistant' && isOwner && <AssistantSettings />}
            {section === 'agents' && isOwner && <TokensTab />}
            {section === 'data' && <Files onText={() => { onOpenChange(false); onText() }} />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
