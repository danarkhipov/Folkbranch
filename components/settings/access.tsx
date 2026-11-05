'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Trash2 } from 'lucide-react'
import { api, useApp } from '@/lib/client'
import { personName, type Role } from '@/lib/types'
import { PersonPopover } from '../person-pickers'
import { INVITE_ROLES, ROLES, roleName } from './roles'

export function Access() {
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
