'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, Check, ChevronDown, Circle, Download, Upload, UserPlus, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyField } from '@/components/ui/copy'
import { api, useApp } from '@/lib/client'
import { ProviderForm } from '../assistant-setup'
import { Brand, type BrandName } from '../brand-icons'
import { Access } from './access'
import { TokensTab } from './tokens'

interface Status { address: string; addressWrong: string | null; insecure: boolean; dataDir: string; freeBytes: number | null; lowDisk: boolean; people: number; users: number; agents: number; assistant: string | null; assistantOn: boolean; signIn: boolean; mcpUrl: string }

type State = 'done' | 'todo' | 'problem' | 'optional'
const MARK: Record<State, [LucideIcon, string, string]> = { done: [Check, 'text-[#2f7d4f]', 'Готово'], problem: [AlertTriangle, 'text-destructive', 'Нужно исправить'], todo: [Circle, 'text-ink-faint', 'Ещё не сделано'], optional: [Circle, 'text-ink-faint', ''] }

function Step({ title, state, logos = [], open, onToggle, children }: { title: string; state: State; logos?: BrandName[]; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  const { t } = useApp()
  const [Icon, color, word] = MARK[state]
  return (
    <section className="rounded-lg border border-border bg-white min-w-0">
      <div className="flex items-center gap-2 pr-3 min-h-11">
        <button type="button" aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 self-stretch pl-3 text-left" onClick={onToggle}>
          <Icon size={15} className={`flex-none ${color}`} aria-hidden="true" />
          <span className="min-w-0 flex-1 font-medium break-anywhere">{t(title)}</span>
          <ChevronDown size={14} className={`flex-none text-ink-soft transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {logos.map((l) => <Brand key={l} name={l} size={15} className="max-sm:hidden text-ink-soft" />)}
        {word && <span className={`text-xs flex-none ${state === 'problem' ? 'text-destructive' : 'text-ink-soft'}`}>{t(word)}</span>}
      </div>
      {open && <div className="flex flex-col gap-2 px-3 pb-3 text-sm">{children}</div>}
    </section>
  )
}

/** Everything the app needs, one step each, with what is missing saying so. Each step can be skipped and come back to. */
export function SetupGuide({ onImport, onFirstPerson, onGo }: { onImport?: () => void; onFirstPerson?: () => void; onGo?: (section: 'people' | 'signin' | 'assistant' | 'agents' | 'data') => void }) {
  const { t, lang } = useApp()
  const qc = useQueryClient()
  const { data: s } = useQuery({ queryKey: ['setup'], queryFn: () => api<Status>('setup/status') })
  const [open, setOpen] = useState<string | null>(null)
  if (!s) return <div className="h-40" />
  const toggle = (id: string) => () => setOpen(open === id ? null : id)
  // In the settings a step leads to its own screen; the same form is not repeated here.
  const go = (section: 'people' | 'signin' | 'assistant' | 'agents' | 'data', label: string) => <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => onGo!(section)}>{t(label)} <ArrowRight /></Button>
  const addressState: State = s.addressWrong || s.insecure || s.lowDisk ? 'problem' : 'done'
  const gb = s.freeBytes === null ? null : new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(s.freeBytes / 1024 ** 3)
  return (
    <div className="flex min-w-0 flex-col gap-2 text-sm">
      <Step title="Ваша семья" state={s.people ? 'done' : 'todo'} open={open === 'family'} onToggle={toggle('family')}>
        <p className="text-ink-soft">{s.people ? `${t('Людей в архиве')}: ${s.people}.` : t('Добавьте первого человека или загрузите файл GEDCOM, Excel, CSV либо обычный текст.')}</p>
        <div className="flex flex-wrap gap-2">
          {onFirstPerson && <button type="button" className="add-btn" onClick={onFirstPerson}><UserPlus size={14} /> {t('Добавить человека')}</button>}
          {onImport && <button type="button" className="add-btn" onClick={onImport}><Upload size={14} /> {t('Загрузить файл')}</button>}
        </div>
      </Step>
      <Step title="Позвать родственников" state={s.users > 1 ? 'done' : 'optional'} open={open === 'people'} onToggle={toggle('people')}>
        {onGo ? <><p className="text-ink-soft">{t('Пригласите родственников по ссылке, чтобы они смотрели архив и дополняли его.')}</p>{go('people', 'Пригласить человека')}</> : <Access />}
      </Step>
      <Step title="Сделать копию" state="optional" open={open === 'copy'} onToggle={toggle('copy')}>
        <p className="text-ink-soft">{t('Один файл со всем архивом и фотографиями. Из него можно восстановиться на новой установке.')}</p>
        <Button asChild size="sm" variant="outline" className="self-start"><a href="/api/archive" download><Download /> {t('Скачать полный архив')}</a></Button>
      </Step>
      <Step title="Способы входа" state={s.signIn ? 'done' : 'optional'} logos={['yandex', 'vk', 'telegram', 'google']} open={open === 'signin'} onToggle={toggle('signin')}>
        <p className="text-ink-soft">{t('Без этого родственники входят по ссылке-приглашению. Включите Яндекс ID, VK ID, Telegram, Google или код на почту, и они смогут входить снова сами.')}</p>
        {onGo ? go('signin', 'Выбрать способы входа') : <p>{t('Они включаются в «Настройки → Способы входа».')}</p>}
      </Step>
      <Step title="ИИ-ассистент" state={s.assistant ? (s.assistantOn ? 'done' : 'todo') : 'optional'} logos={['openrouter', 'anthropic', 'openai', 'gemini']} open={open === 'assistant'} onToggle={toggle('assistant')}>
        {onGo ? <><p className="text-ink-soft">{s.assistant ? `${t('Подключён')}: ${s.assistant}.` : t('Отвечает на вопросы об архиве и вносит правки. Нужен ключ одного из сервисов, платите вы сами этому сервису. Что ассистент читает, уходит туда.')}</p>{go('assistant', 'Открыть настройки ассистента')}</> : s.assistant
          ? <p className="flex flex-wrap items-center gap-2">{t('Подключён')}: {s.assistant}. {!s.assistantOn && <button type="button" className="bar-btn border border-border" onClick={async () => { await api('settings', { method: 'PATCH', json: { assistantEnabled: '1' } }); qc.invalidateQueries({ queryKey: ['setup'] }) }}>{t('Включить')}</button>}</p>
          : <><p className="text-ink-soft">{t('Отвечает на вопросы об архиве и вносит правки. Нужен ключ одного из сервисов, платите вы сами этому сервису. Что ассистент читает, уходит туда.')}</p><ProviderForm onDone={async () => { await api('settings', { method: 'PATCH', json: { assistantEnabled: '1' } }); qc.invalidateQueries({ queryKey: ['setup'] }) }} /></>}
      </Step>
      <Step title="Подключить внешнюю программу" state={s.agents ? 'done' : 'optional'} logos={['claudecode', 'codex', 'cursor', 'mcp']} open={open === 'mcp'} onToggle={toggle('mcp')}>
        <p className="text-ink-soft">{t('Программа сможет читать архив и предлагать правки. Создайте ключ и скопируйте команду для своей программы. На компьютере с установленным приложением хватит одной команды:')} <code>./folkbranch connect</code></p>
        {onGo ? go('agents', 'Создать ключ') : <><CopyField label={t('Адрес для подключения')} value={s.mcpUrl} /><TokensTab /></>}
      </Step>
      <Step title="Адрес и хранилище" state={addressState} open={open === 'address' || addressState === 'problem'} onToggle={toggle('address')}>
        <p><span className="text-ink-soft">{t('Адрес')}:</span> <code className="break-all">{s.address}</code></p>
        {s.addressWrong && <p role="alert" className="text-destructive break-anywhere">{t('В настройках указан другой адрес, поэтому вход работать не будет')}: <b>{s.addressWrong}</b>. {t('Поменяйте BETTER_AUTH_URL и перезапустите приложение.')}</p>}
        {s.insecure && <p role="alert" className="text-destructive">{t('Адрес без https: ссылки для входа передаются в открытом виде. На сервере запускайте установку с --domain.')}</p>}
        <p><span className="text-ink-soft">{t('Данные лежат в')}:</span> <code className="break-all">{s.dataDir}</code>{gb && ` · ${t('свободно')} ${gb} ${t('ГБ')}`}</p>
        {s.lowDisk && <p role="alert" className="text-destructive">{t('На диске почти не осталось места. Освободите место, иначе новые файлы не сохранятся.')}</p>}
      </Step>
    </div>
  )
}
