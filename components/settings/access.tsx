'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronsUpDown, RefreshCw, Trash2, UserPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyField } from '@/components/ui/copy'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { List, ListRow, Section } from '@/components/ui/section'
import { Select } from '@/components/ui/select'
import { api, useApp, useLinkOrigin } from '@/lib/client'
import { personName, type Role } from '@/lib/types'
import { PersonPopover } from '../person-pickers'
import { INVITE_ROLES, ROLES, roleHelp, roleName } from './roles'

export function Access() {
  const { t, me, byId, confirm: ask } = useApp()
  const origin = useLinkOrigin()
  const qc = useQueryClient()
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => api<{ id: string; name: string; role: Role; personId: string | null }[]>('users') })
  const { data: invites = [] } = useQuery({ queryKey: ['invites'], queryFn: () => api<{ id: string; name: string; role: Role }[]>('invites') })
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('editor')
  const [personId, setPersonId] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const refresh = () => { qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['invites'] }) }
  const makeLink = async (json: unknown) => {
    const { token } = await api<{ token: string }>('invites', { json })
    setLink(`${origin}/invite/${token}`)
    refresh()
  }
  const person = personId ? byId.get(personId) : null
  return (
    <div className="flex min-w-0 flex-col gap-7 text-sm">
      <Section title={t('Пригласить человека')} description={t('Вы получите ссылку и отправите её сами. Она одноразовая и действует 30 дней.')}>
        <form className="flex flex-col gap-3" onSubmit={async (e) => { e.preventDefault(); if (name.trim()) { await makeLink({ name: name.trim(), role, personId }); setName(''); setPersonId(null) } }}>
          <Field label={t('Имя')}><Input required placeholder={t('Например, тётя Лена')} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <Field label={t('Что сможет делать')} hint={t(roleHelp[role])}><Select aria-label={t('Что сможет делать')} value={role} onChange={(v) => setRole(v as Role)} options={INVITE_ROLES.map((r) => ({ value: r, label: t(roleName[r]) }))} /></Field>
            <div className="flex min-w-0 flex-col gap-1 text-xs text-ink-soft">{t('Карточка на схеме (необязательно)')}
              <PersonPopover onPick={setPersonId} exclude={[...byId.values()].filter((p) => !p.living || p.deathDate).map((p) => p.id)}>
                <button type="button" className="flex h-9 min-w-0 items-center justify-between gap-1.5 rounded-lg border border-input bg-white pl-3 pr-2.5 text-left text-sm text-ink"><span className="truncate">{person ? personName(person) : t('Выбрать карточку')}</span><ChevronsUpDown size={14} className="flex-none text-ink-soft" /></button>
              </PersonPopover>
              <span className="leading-snug">{t('Схема покажет этому человеку, кем ему приходится каждый.')}</span>
            </div>
          </div>
          <Button className="self-start" disabled={!name.trim()} title={name.trim() ? undefined : t('Сначала введите имя')}><UserPlus /> {t('Создать приглашение')}</Button>
          {link && <CopyField label={t('Отправьте эту ссылку человеку')} value={link} primary />}
        </form>
      </Section>
      <Section title={t('Люди с доступом')}>
        <List>
          {users.map((u) => u.id === me.id
            ? <ListRow key={u.id} title={`${u.name} (${t('вы')})`} meta={t(roleName[u.role])} />
            : <ListRow key={u.id} title={u.name} actions={<>
              <Select look="small" className="w-32" aria-label={`${t('Что сможет делать')}: ${u.name}`} value={u.role} onChange={async (v) => { await api(`users/${u.id}`, { method: 'PATCH', json: { role: v } }); refresh() }} options={ROLES.map((r) => ({ value: r, label: t(roleName[r]) }))} />
              <Button size="sm" variant="outline" title={t('Новая ссылка для входа')} data-hint={t('Если человек потерял вход или сменил устройство.')} onClick={() => makeLink({ name: u.name, role: u.role, userId: u.id })}><RefreshCw /> {t('Новая ссылка')}</Button>
              <Button size="icon-sm" variant="danger" title={t('Закрыть доступ')} aria-label={`${t('Закрыть доступ')}: ${u.name}`} data-hint={t('Человек больше не сможет войти. Его правки останутся.')} onClick={async () => { if (await ask(`${t('Закрыть доступ')}: ${u.name}?`, t('Закрыть доступ'))) { await api(`users/${u.id}`, { method: 'DELETE' }); refresh() } }}><Trash2 /></Button>
            </>} />)}
        </List>
      </Section>
      {invites.length > 0 && (
        <Section title={t('Приглашены, но ещё не вошли')}>
          <List>
            {invites.map((i) => <ListRow key={i.id} title={i.name} meta={t(roleName[i.role])} actions={<Button size="sm" variant="outline" onClick={async () => { await api(`invites/${i.id}`, { method: 'DELETE' }); refresh() }}><X /> {t('Отменить приглашение')}</Button>} />)}
          </List>
        </Section>
      )}
    </div>
  )
}
