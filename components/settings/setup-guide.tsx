'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, ChevronDown, Circle, Download, Upload, UserPlus, type LucideIcon } from 'lucide-react'
import { api, useApp } from '@/lib/client'
import { ProviderForm } from '../assistant-setup'
import { Brand, type BrandName } from '../brand-icons'
import { Access } from './access'
import { TokensTab } from './tokens'

interface Status { address: string; addressWrong: string | null; insecure: boolean; dataDir: string; freeBytes: number | null; lowDisk: boolean; people: number; users: number; agents: number; assistant: string | null; assistantOn: boolean; google: boolean; yandex: boolean; mcpUrl: string }

type State = 'done' | 'todo' | 'problem' | 'optional'
const MARK: Record<State, [LucideIcon, string, string]> = { done: [Check, 'text-[#2f7d4f]', 'Готово'], problem: [AlertTriangle, 'text-destructive', 'Нужно исправить'], todo: [Circle, 'text-ink-faint', 'Ещё не сделано'], optional: [Circle, 'text-ink-faint', 'По желанию'] }

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
        <span className={`text-xs flex-none ${state === 'problem' ? 'text-destructive' : 'text-ink-soft'}`}>{t(word)}</span>
      </div>
      {open && <div className="flex flex-col gap-2 px-3 pb-3 text-sm">{children}</div>}
    </section>
  )
}

/** Everything the app needs, one step each, with what is missing saying so. Each step can be skipped and come back to. */
export function SetupGuide({ onImport, onFirstPerson }: { onImport?: () => void; onFirstPerson?: () => void }) {
  const { t, lang } = useApp()
  const qc = useQueryClient()
  const { data: s } = useQuery({ queryKey: ['setup'], queryFn: () => api<Status>('setup/status') })
  const [open, setOpen] = useState<string | null>(null)
  if (!s) return <div className="h-40" />
  const toggle = (id: string) => () => setOpen(open === id ? null : id)
  const addressState: State = s.addressWrong || s.insecure || s.lowDisk ? 'problem' : 'done'
  const gb = s.freeBytes === null ? null : new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(s.freeBytes / 1024 ** 3)
  return (
    <div className="flex min-w-0 flex-col gap-2 text-sm">
      <Step title="Адрес и хранилище" state={addressState} open={open === 'address' || addressState === 'problem'} onToggle={toggle('address')}>
        <p><span className="text-ink-soft">{t('Адрес')}:</span> <code className="break-all">{s.address}</code></p>
        {s.addressWrong && <p role="alert" className="text-destructive break-anywhere">{t('В настройках указан другой адрес, поэтому вход работать не будет')}: <b>{s.addressWrong}</b>. {t('Поменяйте BETTER_AUTH_URL и перезапустите приложение.')}</p>}
        {s.insecure && <p role="alert" className="text-destructive">{t('Адрес без https: ссылки для входа передаются в открытом виде. На сервере запускайте установку с --domain.')}</p>}
        <p><span className="text-ink-soft">{t('Данные лежат в')}:</span> <code className="break-all">{s.dataDir}</code>{gb && ` · ${t('свободно')} ${gb} ${t('ГБ')}`}</p>
        {s.lowDisk && <p role="alert" className="text-destructive">{t('На диске осталось меньше гигабайта. Освободите место, иначе новые файлы не сохранятся.')}</p>}
      </Step>
      <Step title="Ваша семья" state={s.people ? 'done' : 'todo'} open={open === 'family'} onToggle={toggle('family')}>
        <p className="text-ink-soft">{s.people ? `${t('Людей в архиве')}: ${s.people}.` : t('Добавьте первого человека или загрузите файл GEDCOM, Excel, CSV либо обычный текст.')}</p>
        <div className="flex flex-wrap gap-2">
          {onFirstPerson && <button type="button" className="add-btn" onClick={onFirstPerson}><UserPlus size={14} /> {t('Добавить человека')}</button>}
          {onImport && <button type="button" className="add-btn" onClick={onImport}><Upload size={14} /> {t('Загрузить файл')}</button>}
        </div>
      </Step>
      <Step title="Подключить агента по MCP" state={s.agents ? 'done' : 'optional'} logos={['claudecode', 'codex', 'cursor', 'mcp']} open={open === 'mcp'} onToggle={toggle('mcp')}>
        <p className="text-ink-soft">{t('Агент сможет читать архив и предлагать правки. Создайте ключ и скопируйте команду для своей программы. На компьютере с установленным приложением хватит одной команды:')} <code>./folkbranch connect</code></p>
        <p><span className="text-ink-soft">{t('Адрес для подключения')}:</span> <code className="break-all">{s.mcpUrl}</code></p>
        <TokensTab />
      </Step>
      <Step title="Встроенный ассистент" state={s.assistant ? (s.assistantOn ? 'done' : 'todo') : 'optional'} logos={['openrouter', 'anthropic', 'openai', 'gemini']} open={open === 'assistant'} onToggle={toggle('assistant')}>
        {s.assistant
          ? <p className="flex flex-wrap items-center gap-2">{t('Подключён')}: {s.assistant}. {!s.assistantOn && <button type="button" className="bar-btn border border-border" onClick={async () => { await api('settings', { method: 'PATCH', json: { assistantEnabled: '1' } }); qc.invalidateQueries({ queryKey: ['setup'] }) }}>{t('Включить')}</button>}</p>
          : <><p className="text-ink-soft">{t('Отвечает на вопросы об архиве и вносит правки. Нужен ключ одного из сервисов, платите вы сами этому сервису. Что ассистент читает, уходит туда.')}</p><ProviderForm onDone={async () => { await api('settings', { method: 'PATCH', json: { assistantEnabled: '1' } }); qc.invalidateQueries({ queryKey: ['setup'] }) }} /></>}
      </Step>
      <Step title="Позвать родственников" state={s.users > 1 ? 'done' : 'optional'} open={open === 'people'} onToggle={toggle('people')}>
        <Access />
      </Step>
      <Step title="Вход через Google, Яндекс" state={s.google || s.yandex ? 'done' : 'optional'} logos={['google', 'yandex']} open={open === 'signin'} onToggle={toggle('signin')}>
        <p className="text-ink-soft">{t('Без этого родственники входят по ссылке-приглашению. Чтобы они могли входить снова сами, создайте доступ у сервиса и добавьте его в настройки приложения.')}</p>
        <ul className="flex flex-col gap-1.5">
          <li className="flex flex-wrap items-center gap-1.5"><Brand name="google" /> Google: <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>. {t('Адрес возврата')}: <code className="break-all">{s.address}/api/auth/callback/google</code></li>
          <li className="flex flex-wrap items-center gap-1.5"><Brand name="yandex" className="text-[#fc3f1d]" /> {t('Яндекс')}: <code>YANDEX_CLIENT_ID</code>, <code>YANDEX_CLIENT_SECRET</code>. {t('Адрес возврата')}: <code className="break-all">{s.address}/api/auth/oauth2/callback/yandex</code></li>
        </ul>
      </Step>
      <Step title="Сделать копию" state="optional" open={open === 'copy'} onToggle={toggle('copy')}>
        <p className="text-ink-soft">{t('Один файл со всем архивом и фотографиями. Из него можно восстановиться на новой установке.')}</p>
        <a className="add-btn self-start" href="/api/archive" download><Download size={14} /> {t('Скачать полный архив')}</a>
      </Step>
    </div>
  )
}
