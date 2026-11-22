'use client'
import { useState, type ComponentType } from 'react'
import { AudioLines, ChevronLeft, ChevronRight, Cpu, DatabaseBackup, DoorOpen, KeyRound, Lightbulb, Map as MapIcon, ScanFace, Sparkles, ListChecks, SlidersHorizontal, UserRound, Users } from 'lucide-react'
import { AssistantIcon } from '../assistant-icon'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useApp } from '@/lib/client'
import { cn } from '@/lib/utils'
import { Account } from './account'
import { Access } from './access'
import { Archive } from './archive'
import { Files } from './files'
import { MapSettings } from './map'
import { FeatureGuide } from '../feature-guide'
import { CloudSpeech } from './cloud-speech'
import { CloudFaces } from './cloud-faces'
import { AiOverview } from './ai-overview'
import { AssistantSettings } from './assistant'
import { SetupGuide } from './setup-guide'
import { ShareLinks } from './share-links'
import { SignInMethods } from './sign-in-methods'
import { SmartSettings } from './smart'
import type { SignInMethods as Methods } from '@/lib/sign-in-methods'
import { TokensTab } from './tokens'

export type Section = 'ai' | 'speech' | 'faces' | 'tips' | 'setup' | 'account' | 'smart' | 'general' | 'people' | 'signin' | 'assistant' | 'agents' | 'data' | 'map'

/** Each screen says what it is for, so nobody has to work it out from the fields. */
const SECTIONS: Record<Section, [string, string, ComponentType<{ size?: number }>]> = {
  ai: ['AI', 'Usage, AI features, providers and the archive\'s MCP server.', Sparkles],
  speech: ['Speech recognition', 'One speech recognition provider for the whole archive: the owner connects and pays for it.', AudioLines],
  faces: ['Face recognition', 'One face recognition provider for the whole archive: the owner connects and pays for it.', ScanFace],
  tips: ['Features and tips', 'Everything the app can do, and what usually goes unnoticed.', Lightbulb],
  setup: ['Getting started', 'What is ready and what else you can connect. Anything optional can be skipped.', ListChecks],
  account: ['My account', 'How you relate to the archive and how you sign in.', UserRound],
  smart: ['Models on this device', 'Face and speech recognition right in the browser: nothing leaves it.', Cpu],
  general: ['General settings', 'The name of the archive and the language of the app. They change for everyone at once.', SlidersHorizontal],
  signin: ['Ways to sign in', 'How relatives sign in after the first link: Yandex ID, VK ID, Telegram, Google or a code by email.', DoorOpen],
  people: ['Users and access', 'Who can sign in and what they can do, and who only needs a view link.', Users],
  assistant: ['Assistant', 'A chat in the app: it answers questions about the family and makes changes once you confirm.', AssistantIcon],
  agents: ['MCP server and access tokens', 'The archive is an MCP server: Claude, ChatGPT, Cursor and other clients connect with an access token.', KeyRound],
  data: ['Data and backups', 'Add people from a file, download data, make a copy of the archive.', DatabaseBackup],
  map: ['Map', 'History and the chronicle on the family map, filled in by agents.', MapIcon],
}

/** The pages that open from the AI screen. */
const AI_PAGES: Section[] = ['assistant', 'speech', 'faces', 'agents', 'smart']

export function SettingsDialog({ open, onOpenChange, familyName, providers, onText, initial }: { open: boolean; onOpenChange: (v: boolean) => void; familyName: string; providers: Methods; onText: () => void; initial?: Section }) {
  const { t, me, archiveLang } = useApp()
  const isOwner = me.role === 'owner'
  const [section, setSectionNow] = useState<Section>(initial ?? (isOwner ? 'setup' : 'account'))
  // On a phone the list and a section take turns on the screen; a row of tabs there hid most of the sections.
  const [inside, setInside] = useState(!!initial)
  const setSection = (next: Section) => { setSectionNow(next); setInside(true) }
  const groups: [string, Section[]][] = isOwner
    ? [['', ['setup', 'tips', 'account']], ['Main settings', ['general', 'people', 'signin', 'map', 'data', 'ai']]]
    : [['', ['account', 'tips', 'smart', 'data']]]
  const [title, description] = SECTIONS[section]
  // For the owner the AI pages open from the AI screen: the list shows only "AI", and each page has a way back to it.
  const underAi = isOwner && AI_PAGES.includes(section)
  const current = underAi ? 'ai' : section
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(680px,calc(100dvh-32px))] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav aria-label={t('Settings')} className={cn('flex shrink-0 flex-col gap-0.5 overflow-y-auto p-2 max-sm:min-h-0 max-sm:flex-1 sm:w-[268px] sm:border-r sm:border-border sm:bg-muted/40', inside && 'max-sm:hidden')}>
            <DialogTitle className="px-2.5 pt-1.5 pb-3 font-serif text-lg font-medium">{t('Settings')}</DialogTitle>
            {groups.map(([group, ids]) => (
              <div key={group} className={group ? 'mt-4 border-t border-[#d9d0bd] pt-3.5' : ''}>
                {group && <div className="px-2.5 pb-1.5 font-serif text-sm font-semibold text-ink">{t(group)}</div>}
                {ids.map((id) => {
                  const Icon = SECTIONS[id][2]
                  return <button key={id} className={`settings-item flex w-full shrink-0 items-center gap-2 rounded-lg px-2.5 min-h-9 max-sm:min-h-11 text-left text-sm ${current === id ? 'on bg-muted font-medium text-ink' : 'text-[#5a5245] hover:bg-muted/60 hover:text-ink'}`} aria-current={current === id ? 'page' : undefined} onClick={() => setSection(id)}><span className="flex-none"><Icon size={15} /></span> {t(SECTIONS[id][0])}<ChevronRight size={15} className="ml-auto flex-none text-ink-faint sm:hidden" /></button>
                })}
              </div>
            ))}
          </nav>
          <div className={cn('min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6', !inside && 'max-sm:hidden')}>
            <button type="button" className="pick -ml-1 mb-2 flex items-center gap-0.5 text-sm text-ink-soft hover:text-ink min-h-9 sm:hidden" onClick={() => setInside(false)}><ChevronLeft size={16} /> {t('Settings')}</button>
            {underAi && <button type="button" className="pick -ml-1 mb-1 flex items-center gap-0.5 text-sm text-[#a4502e] hover:text-ink min-h-8" onClick={() => setSectionNow('ai')}><ChevronLeft size={16} /> {t('AI')}</button>}
            <header className="mb-5 pr-6">
              <h2 className="font-serif text-xl font-medium">{t(title)}</h2>
              <DialogDescription className="mt-0.5 text-sm text-ink-soft">{t(description)}</DialogDescription>
            </header>
            {section === 'ai' && isOwner && <AiOverview onGo={setSection} />}
            {section === 'setup' && isOwner && <SetupGuide onGo={setSection} />}
            {section === 'tips' && <FeatureGuide onGo={setSection} />}
            {section === 'account' && <Account providers={providers} />}
            {section === 'smart' && <SmartSettings />}
            {section === 'general' && isOwner && <Archive familyName={familyName} lang={archiveLang} />}
            {section === 'people' && isOwner && <div className="flex min-w-0 flex-col gap-7"><Access /><ShareLinks /></div>}
            {section === 'signin' && isOwner && <SignInMethods />}
            {section === 'speech' && isOwner && <CloudSpeech />}
            {section === 'faces' && isOwner && <CloudFaces />}
            {section === 'assistant' && isOwner && <AssistantSettings />}
            {section === 'agents' && isOwner && <TokensTab />}
            {section === 'map' && isOwner && <MapSettings />}
            {section === 'data' && <Files onText={() => { onOpenChange(false); onText() }} />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
