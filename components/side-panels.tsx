'use client'
import { ImportDialog } from './import-dialog'
import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive as Archive_, ArrowLeftRight, ArrowRight, Check, Copy, Download, FileText, KeyRound, LogOut, Trash2, Undo2, Upload, UserRound, Users, X, type LucideIcon } from 'lucide-react'
import { AssistantIcon } from './assistant-icon'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { api, undoFailure, useApp, useWrite } from '@/lib/client'
import { cn } from '@/lib/utils'
import { personName, type HistoryEntry, type Lang, type Role } from '@/lib/types'
import { Mini, PersonPopover } from './person-pickers'
import { AssistantSettings, TokensTab } from './ai-panels'

/** "Кем приходится?": two people, an answer in words, the path lit on the graph. */
export function HowRelated({ onPath, onClose }: { onPath: (ids: string[] | null) => void; onClose: () => void }) {
  const { t, byId, family, lang, me } = useApp()
  const [a, setA] = useState<string | null>(me.personId)
  const [b, setB] = useState<string | null>(null)
  const kin = useMemo(() => (a && b && a !== b ? family.relation(a, b, lang) : null), [a, b, family, lang])
  const lastPath = useRef<string>('')
  const key = kin?.path.join() ?? ''
  if (key !== lastPath.current) {
    lastPath.current = key
    queueMicrotask(() => onPath(kin?.path ?? null))
  }
  const slot = (id: string | null, set: (v: string) => void, placeholder: string) => {
    const p = id ? byId.get(id) : null
    return (
      <PersonPopover onPick={set}>
        <button className="flex items-center gap-2 h-9 px-2 rounded-lg border border-input bg-white w-full text-left text-sm">
          {p ? <><Mini person={p} /> <span className="truncate">{personName(p)}</span></> : <span className="text-ink-faint">{t(placeholder)}</span>}
        </button>
      </PersonPopover>
    )
  }
  return (
    <div className="float side-sheet fixed left-3 top-[60px] w-80 p-3 z-10 flex flex-col gap-2">
      <div className="flex items-center justify-between"><h3 className="font-serif font-medium text-lg">{t('Кем приходится?')}</h3><button className="text-ink-faint hover:text-ink" aria-label={t('Закрыть')} title={t('Закрыть')} onClick={onClose}><X size={15} /></button></div>
      <p className="text-sm text-ink-soft">{t('Выберите двух людей, и мы покажем, кем они приходятся друг другу.')}</p>
      {slot(a, setA, 'Выбрать первого')}
      {slot(b, setB, 'Выбрать второго')}
      {a && b && a !== b && !kin && <p className="text-sm text-ink-soft">{t('Кровного родства и связи через брак не найдено')}</p>}
      {kin && (
        <div className="pt-1">
          <p className="font-serif text-lg leading-snug"><span className="text-rust">{kin.label}</span></p>
          <p className="text-xs text-ink-soft">{personName(byId.get(b!)!)} — {lang === 'en' ? 'to' : 'для'} {personName(byId.get(a!)!)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-ink-soft">
            {kin.path.map((id, i) => (
              <span key={id} className="flex items-center gap-1">
                {i > 0 && <ArrowRight size={11} className="text-ink-faint" />}
                {personName(byId.get(id)!) || t('Скрыто')}
                {i > 0 && <span className="text-ink-faint">({family.relation(kin.path[i - 1], id, lang)?.label})</span>}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function HistoryPanel({ onClose }: { onClose: () => void }) {
  const { t, canEdit, lang, focus, byId, notify } = useApp()
  const { data: rows = [] } = useQuery({ queryKey: ['history'], queryFn: () => api<HistoryEntry[]>('history') })
  const qc = useQueryClient()
  const undo = useWrite((id: string) => api(`history/${id}/undo`, { json: {} }).then(() => { qc.invalidateQueries() }).catch((e) => notify(undoFailure(e, t))))
  const fmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <div className="float side-sheet fixed left-3 top-[60px] bottom-3 w-80 flex flex-col z-10">
      <div className="flex items-center justify-between px-3 pt-3 pb-2"><h3 className="font-serif font-medium text-lg">{t('История')}</h3><button className="text-ink-faint hover:text-ink" aria-label={t('Закрыть')} title={t('Закрыть')} onClick={onClose}><X size={15} /></button></div>
      <div className="flex-1 overflow-auto px-1.5 pb-2">
        {!rows.length && <p className="px-2 text-sm text-ink-faint">{t('Пока ничего не менялось')}</p>}
        {rows.map((r) => (
          <div key={r.id} className={cn('group rounded-md px-2 py-1.5 hover:bg-muted', r.undoneAt && 'opacity-50')}>
            <button className="text-left text-sm leading-snug" onClick={() => r.personIds[0] && byId.has(r.personIds[0]) && focus(r.personIds[0], { center: true })}>{r.summary}</button>
            <div className="flex items-center text-xs text-ink-faint mt-0.5">
              <span>{r.actorName} · {fmt.format(r.at)}</span>
              {r.undoneAt && <span className="ml-2">{t('Отменено')}</span>}
              {canEdit && !r.undoneAt && !r.undoOf && (
                <button className="ml-auto hidden group-hover:flex [@media(hover:none)]:flex items-center gap-1 hover:text-ink" onClick={() => undo.mutate(r.id)}><Undo2 size={11} /> {t('Отменить')}</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

type Section = 'account' | 'people' | 'archive' | 'assistant' | 'agents' | 'data'

export function SettingsDialog({ open, onOpenChange, familyName, providers, onText }: { open: boolean; onOpenChange: (v: boolean) => void; familyName: string; providers: { google: boolean; yandex: boolean }; onText: () => void }) {
  const { t, me, lang } = useApp()
  const isOwner = me.role === 'owner'
  const [section, setSection] = useState<Section>('account')
  const items: [Section, string, LucideIcon][] = [
    ['account', 'Мой аккаунт', UserRound],
    ...(isOwner ? [['people', 'Люди и доступ', Users], ['archive', 'Архив', Archive_], ['assistant', 'Ассистент', AssistantIcon]] as [Section, string, LucideIcon][] : []),
    ['data', 'Файлы', ArrowLeftRight],
    ...(isOwner ? [['agents', 'Для разработчиков', KeyRound]] as [Section, string, LucideIcon][] : []),
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
            {section === 'account' && <Account providers={providers} />}
            {section === 'people' && isOwner && <Access />}
            {section === 'archive' && isOwner && <Archive familyName={familyName} lang={lang} />}
            {section === 'assistant' && isOwner && <AssistantSettings />}
            {section === 'agents' && isOwner && <TokensTab />}
            {section === 'data' && <DataTab onText={() => { onOpenChange(false); onText() }} />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Who I am here: my card on the chart, how I get back in, where I am signed in. */
function Account({ providers }: { providers: { google: boolean; yandex: boolean } }) {
  const { t, me, byId, notify } = useApp()
  const mine = me.personId ? byId.get(me.personId) : null
  const claim = async (personId: string | null) => {
    try {
      await api('me', { method: 'PATCH', json: { personId } })
      location.reload()
    } catch (e) {
      notify((e as Error).message)
    }
  }
  return (
    <div className="flex flex-col gap-5 text-sm">
      <section className="flex flex-col gap-1">
        <h3 className="text-base font-medium">{me.name}</h3>
        <p className="text-xs text-ink-soft">{t(roleHelp[me.role])}</p>
      </section>
      {me.role !== 'reader' && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-base font-medium">{t('Моя карточка на схеме')}</h3>
          <p className="text-xs text-ink-soft">{t('Выберите себя, и схема покажет, кем вам приходится каждый человек. Подойдёт только живой человек.')}</p>
          <div className="flex items-center gap-2">
            <PersonPopover onPick={claim} exclude={[...byId.values()].filter((p) => !p.living || p.deathDate).map((p) => p.id)}>
              <button type="button" className="h-9 max-w-64 truncate rounded-lg border border-input bg-white px-3">{mine ? personName(mine) : t('Выбрать свою карточку')}</button>
            </PersonPopover>
            {mine && <button type="button" className="text-xs text-ink-soft underline" onClick={() => claim(null)}>{t('Убрать')}</button>}
          </div>
        </section>
      )}
      {(providers.google || providers.yandex) && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-base font-medium">{t('Вход без ссылки')}</h3>
          <p className="text-xs text-ink-soft">{t('Привяжите аккаунт, чтобы входить снова без новой ссылки.')}</p>
          <div className="flex flex-wrap gap-2">
            {providers.google && <button className="bar-btn border border-border" onClick={() => linkAccount('/api/auth/link-social', { provider: 'google', callbackURL: '/' })}>{t('Привязать Google')}</button>}
            {providers.yandex && <button className="bar-btn border border-border" onClick={() => linkAccount('/api/auth/oauth2/link', { providerId: 'yandex', callbackURL: '/' })}>{t('Привязать Яндекс ID')}</button>}
          </div>
        </section>
      )}
      <section className="flex flex-col gap-1.5">
        <h3 className="text-base font-medium">{t('Устройства')}</h3>
        <p className="text-xs text-ink-soft">{t('Если потеряли телефон или входили на чужом компьютере. Выйдут все устройства, кроме этого.')}</p>
        <button type="button" className="bar-btn self-start border border-border" onClick={async () => { await fetch('/api/auth/revoke-other-sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); notify(t('Другие устройства отключены')) }}>{t('Выйти на других устройствах')}</button>
      </section>
      <section className="flex flex-col gap-1.5">
        <h3 className="text-base font-medium">{t('Выход')}</h3>
        <p className="text-xs text-ink-soft">{t('Войти снова можно будет по новой ссылке или через Google и Яндекс, если вы их подключили.')}</p>
        <button type="button" className="bar-btn self-start border border-border" onClick={async () => { await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); location.href = '/login' }}><LogOut size={14} /> {t('Выйти с этого устройства')}</button>
      </section>
    </div>
  )
}

async function linkAccount(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json()
  if (j.url) location.href = j.url
}

const ROLES: Role[] = ['editor', 'reader', 'owner']
const INVITE_ROLES: Role[] = ['editor', 'reader']
const roleName: Record<Role, string> = { owner: 'владелец', editor: 'редактор', reader: 'читатель' }
const roleHelp: Record<Role, string> = {
  owner: 'Вы владелец: можете менять всё, включая настройки и доступ других людей.',
  editor: 'Редактор: видит всех и может менять схему и биографии.',
  reader: 'Читатель: смотрит схему, живые родственники скрыты.',
}

function Access() {
  const { t, me, confirm: ask } = useApp()
  const qc = useQueryClient()
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => api<{ id: string; name: string; role: Role; personId: string | null }[]>('users') })
  const { data: invites = [] } = useQuery({ queryKey: ['invites'], queryFn: () => api<{ id: string; name: string; role: Role }[]>('invites') })
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('editor')
  const [personId, setPersonId] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const [copied, setCopied] = useState(false)
  const { byId } = useApp()
  const refresh = () => { qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['invites'] }) }
  const makeLink = async (json: unknown) => {
    const { token } = await api<{ token: string }>('invites', { json })
    setLink(`${location.origin}/invite/${token}`)
    setCopied(false)
    refresh()
  }
  const person = personId ? byId.get(personId) : null
  return (
    <div className="flex flex-col gap-5 text-sm">
      <form className="flex flex-col gap-2" onSubmit={async (e) => { e.preventDefault(); if (name.trim()) { await makeLink({ name: name.trim(), role, personId }); setName(''); setPersonId(null) } }}>
        <h3 className="text-base font-medium">{t('Пригласить человека')}</h3>
        <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Имя')}
          <input className="h-9 min-w-0 rounded-lg border border-input bg-white px-3 text-sm text-ink" required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
          <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Что сможет делать')}
            <select className="h-9 rounded-lg border border-input bg-white px-2 text-sm text-ink" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {INVITE_ROLES.map((r) => <option key={r} value={r}>{t(roleName[r])}</option>)}
            </select>
          </label>
          <div className="flex flex-col gap-1 text-xs text-ink-soft">{t('Карточка на схеме (необязательно)')}
            <PersonPopover onPick={setPersonId} exclude={[...byId.values()].filter((p) => !p.living || p.deathDate).map((p) => p.id)}>
              <button type="button" className="h-9 min-w-0 truncate rounded-lg border border-input bg-white px-3 text-sm text-ink">{person ? personName(person) : t('Выбрать карточку')}</button>
            </PersonPopover>
          </div>
        </div>
        <p className="text-xs text-ink-soft">{t('Редактор видит всех и может менять схему и биографии. Читатель только смотрит и не видит живых родственников.')}</p>
        <button className="h-9 self-start rounded-lg bg-ink px-3 whitespace-nowrap text-white">{t('Создать приглашение')}</button>
        <p className="text-xs text-ink-soft">{t('Ссылка одноразовая и действует 30 дней.')}</p>
        {link && (
          <div className="flex items-center gap-2 rounded-lg bg-muted px-2 py-1.5">
            <code className="truncate text-xs flex-1">{link}</code>
            <button type="button" className="flex items-center gap-1 text-xs hover:text-ink text-ink-soft" onClick={() => { navigator.clipboard.writeText(link); setCopied(true) }}>{copied ? <Check size={13} /> : <Copy size={13} />}{t(copied ? 'Скопировано' : 'Скопировать')}</button>
          </div>
        )}
      </form>
      <section>
        <h4 className="text-base font-medium mb-1">{t('Люди с доступом')}</h4>
        {users.map((u) => (
          <div key={u.id} className="flex items-center gap-2 py-1">
            <span className="truncate flex-1">{u.name}</span>
            {u.id !== me.id && <button className="text-xs text-ink-soft hover:text-ink" title={t('Если человек потерял вход')} onClick={() => makeLink({ name: u.name, role: u.role, userId: u.id })}>{t('Новая ссылка')}</button>}
            {u.id === me.id ? <span className="text-ink-faint text-xs">{t(roleName[u.role])}</span> : (
              <>
                <select className="bg-transparent text-xs text-ink-soft" value={u.role} onChange={async (e) => { await api(`users/${u.id}`, { method: 'PATCH', json: { role: e.target.value } }); refresh() }}>
                  {ROLES.map((r) => <option key={r} value={r}>{t(roleName[r])}</option>)}
                </select>
                <button className="text-ink-faint hover:text-destructive" title={t('Удалить')} onClick={async () => { if (await ask(`${t('Закрыть доступ')}: ${u.name}?`, t('Закрыть доступ'))) { await api(`users/${u.id}`, { method: 'DELETE' }); refresh() } }}><Trash2 size={13} /></button>
              </>
            )}
          </div>
        ))}
      </section>
      {invites.length > 0 && (
        <section>
          <h4 className="text-base font-medium mb-1">{t('Приглашены, но ещё не вошли')}</h4>
          {invites.map((i) => (
            <div key={i.id} className="flex items-center gap-2 py-1">
              <span className="truncate flex-1">{i.name}</span>
              <span className="text-xs text-ink-faint">{t(roleName[i.role])}</span>
              <button className="bar-btn border border-border" onClick={async () => { await api(`invites/${i.id}`, { method: 'DELETE' }); refresh() }}>{t('Отменить приглашение')}</button>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

function Archive({ familyName, lang }: { familyName: string; lang: Lang }) {
  const { t } = useApp()
  const [name, setName] = useState(familyName)
  const save = (json: unknown) => api('settings', { method: 'PATCH', json }).then(() => location.reload())
  return (
    <div className="flex max-w-sm flex-col gap-3 text-sm">
      <label className="flex flex-col gap-1 text-ink-soft">{t('Название семьи')}
        <input className="h-9 rounded-lg border border-input bg-white px-3 text-ink" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== familyName && name && save({ familyName: name })} />
      </label>
      <label className="flex flex-col gap-1 text-ink-soft">{t('Язык')}
        <select className="h-9 rounded-lg border border-input bg-white px-2 text-ink" value={lang} onChange={(e) => save({ language: e.target.value })}>
          <option value="ru">Русский</option><option value="en">English</option>
        </select>
      </label>
    </div>
  )
}

function DataTab({ onText }: { onText: () => void }) {
  const { t, canEdit, me } = useApp()
  const [hide, setHide] = useState(true)
  const [importing, setImporting] = useState(false)
  return (
    <div className="flex flex-col gap-5 text-sm">
      {canEdit && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-base font-medium">{t('Добавить людей из файла')}</h3>
          <p className="text-xs text-ink-soft">{t('Подойдёт таблица или файл .ged из программы для родословных. Перед добавлением покажем, что изменится. Файл можно просто перетащить на схему.')}</p>
          <button className="bar-btn self-start border border-border" onClick={() => setImporting(true)}><Upload size={14} /> {t('Выбрать файл')}</button>
          <ImportDialog open={importing} onOpenChange={setImporting} />
        </section>
      )}
      <section className="flex flex-col gap-1.5">
        <h3 className="text-base font-medium">{t('Скачать файл для других программ')}</h3>
        <p className="text-xs text-ink-soft">{t('Файл .ged открывается в программах для родословных. В него входят люди и связи, но не биографии и фотографии.')}</p>
        {me.role !== 'reader' && <label className="flex items-center gap-2 text-ink"><input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} /> {t('Не включать живых родственников в файл')}</label>}
        <a className="bar-btn self-start border border-border" href={`/api/v1/gedcom/export?living=${hide ? 'hide' : 'show'}`}><Download size={14} /> {t('Скачать файл')}</a>
      </section>
      <section className="flex flex-col gap-1.5">
        <h3 className="text-base font-medium">{t('Схема текстом')}</h3>
        <p className="text-xs text-ink-soft">{t('Вся схема как простой текст: удобно посмотреть, скопировать или дописать сразу много людей.')}</p>
        <button className="bar-btn self-start border border-border" onClick={onText}><FileText size={14} /> {t('Открыть текст')}</button>
      </section>
    </div>
  )
}
