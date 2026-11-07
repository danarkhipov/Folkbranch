'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, KeyRound, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyField } from '@/components/ui/copy'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { List, ListRow, Section } from '@/components/ui/section'
import { Select } from '@/components/ui/select'
import { SwitchRow } from '@/components/ui/switch'
import { api, useApp } from '@/lib/client'
import { Brand, type BrandName } from '../brand-icons'

interface TokenRow { id: string; name: string; role: 'reader' | 'editor'; review: boolean; createdAt: number; lastUsedAt: number | null; revokedAt: number | null; expiresAt: number | null }

type Client = 'claude' | 'codex' | 'cursor' | 'windsurf' | 'json' | 'prompt'

const CLIENTS: [Client, string, BrandName | null][] = [['claude', 'Claude Code', 'claudecode'], ['codex', 'Codex', 'codex'], ['cursor', 'Cursor', 'cursor'], ['windsurf', 'Windsurf', 'windsurf'], ['json', 'Другая программа', 'mcp'], ['prompt', 'Задание агенту', null]]
/** Where each program keeps its connections, for the ones with no command for it. */
const FILES: Partial<Record<Client, string>> = { cursor: '~/.cursor/mcp.json', windsurf: '~/.codeium/windsurf/mcp_config.json' }

export function TokensTab() {
  const { t, lang, confirm: ask } = useApp()
  const qc = useQueryClient()
  const { data = [] } = useQuery({ queryKey: ['tokens'], queryFn: () => api<TokenRow[]>('tokens') })
  const rows = data.filter((r) => !r.revokedAt)
  const [name, setName] = useState('')
  const [role, setRole] = useState<'reader' | 'editor'>('reader')
  const [review, setReview] = useState(true)
  const [days, setDays] = useState('365')
  const [made, setMade] = useState('')
  const refresh = () => qc.invalidateQueries({ queryKey: ['tokens'] })
  const origin = typeof location === 'undefined' ? '' : location.origin
  const [client, setClient] = useState<Client>('claude')
  const snippet = client === 'claude'
    ? `claude mcp add --transport http folkbranch ${origin}/api/mcp --header "Authorization: Bearer ${made}"`
    : client === 'codex'
      ? `export FOLKBRANCH_TOKEN=${made}\ncodex mcp add folkbranch --url ${origin}/api/mcp --bearer-token-env-var FOLKBRANCH_TOKEN`
    : client !== 'prompt'
      ? JSON.stringify({ mcpServers: { folkbranch: { type: 'http', url: `${origin}/api/mcp`, headers: { Authorization: `Bearer ${made}` } } } }, null, 2)
      : t('Подключись к семейному архиву по MCP. Сначала вызови get_overview, затем find_gaps. Прежде чем создавать человека, ищи его через search_people. Каждое найденное значение записывай через add_version с источником и его достоверностью, а не перезаписывай поля.')
  const date = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' })
  const meta = (r: TokenRow) => [
    t(r.role === 'reader' ? 'Только чтение' : r.review ? 'Правки через проверку' : 'Правит сразу'),
    `${t('создан')} ${date.format(r.createdAt)}`,
    r.lastUsedAt ? `${t('использован')} ${date.format(r.lastUsedAt)}` : t('ещё не использовался'),
    r.expiresAt ? `${t(r.expiresAt < Date.now() ? 'истёк' : 'действует до')} ${date.format(r.expiresAt)}` : t('бессрочно'),
  ].join(' · ')
  return (
    <div className="flex min-w-0 flex-col gap-7 text-sm">
      <Section title={t('Новый ключ')} description={t('Ключ показывается один раз. Выдавайте отдельный на каждую программу, тогда его можно будет отозвать, не трогая остальные.')}>
        <form className="flex flex-col gap-3" onSubmit={async (e) => {
          e.preventDefault()
          if (!name.trim()) return
          const r = await api<{ token: string }>('tokens', { json: { name: name.trim(), role, review, expiresInDays: days ? Number(days) : null } })
          setMade(r.token)
          setName('')
          refresh()
        }}>
          <Field label={t('Название ключа')}><Input placeholder={t('Например, Claude на ноутбуке')} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <Field label={t('Что сможет делать')}><Select aria-label={t('Что сможет делать')} value={role} onChange={(v) => setRole(v as 'reader' | 'editor')} options={[{ value: 'reader', label: t('Только чтение') }, { value: 'editor', label: t('Читать и предлагать правки') }]} /></Field>
            <Field label={t('Срок действия')}><Select aria-label={t('Срок действия')} value={days} onChange={setDays} options={[{ value: '1', label: t('на день') }, { value: '30', label: t('на месяц') }, { value: '365', label: t('на год') }, { value: '', label: t('бессрочно') }]} /></Field>
          </div>
          <p className="text-xs leading-snug text-ink-soft">{t(role === 'editor' ? 'Ключ редактора видит живых родственников, и эти данные уйдут к поставщику нейросети.' : 'Ключ только для чтения не видит живых родственников.')}</p>
          {role === 'editor' && <SwitchRow title={t('Правки через проверку')} description={t('Правки ждут вашего подтверждения в разделе «Проверка».')} checked={review} onChange={setReview} />}
          <Button className="self-start" disabled={!name.trim()}><KeyRound /> {t('Создать ключ доступа')}</Button>
        </form>
        {made && (
          <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-white p-3">
            <p className="font-medium">{t('Ключ показан один раз, сохраните его.')}</p>
            <div role="radiogroup" aria-label={t('Куда подключить')} className="inline-flex flex-wrap self-start rounded-lg bg-muted p-0.5 gap-0.5 text-xs">
              {CLIENTS.map(([c, title, logo]) => <button key={c} type="button" role="radio" aria-checked={client === c} className={client === c ? 'inline-flex items-center gap-1 h-7 px-2 rounded-md bg-white shadow-sm font-medium' : 'inline-flex items-center gap-1 h-7 px-2 rounded-md text-ink-soft hover:text-ink'} onClick={() => setClient(c)}>{logo && <Brand name={logo} size={13} />}{title === 'Другая программа' || title === 'Задание агенту' ? t(title) : title}</button>)}
            </div>
            {FILES[client] && <p className="text-xs text-ink-soft">{t('Вставьте это в файл')} <code>{FILES[client]}</code></p>}
            {client === 'codex' && <p className="text-xs text-ink-soft">{t('Первую строку добавьте и в настройки оболочки, чтобы ключ был при каждом запуске.')}</p>}
            <CopyField value={snippet} primary multiline />
          </div>
        )}
      </Section>
      <Section title={t('Выданные ключи')}>
        {!rows.length && <p className="text-xs text-ink-soft">{t('Пока ни одного. Программы не имеют доступа к архиву.')}</p>}
        <List>
          {rows.map((r) => <ListRow key={r.id} title={r.name} meta={meta(r)} actions={<Button size="sm" variant="danger" title={`${t('Отозвать')}: ${r.name}`} data-hint={t('Программа с этим ключом сразу потеряет доступ.')} onClick={async () => { if (await ask(`${t('Отозвать ключ')} «${r.name}»?`, t('Отозвать'), t('Программа с этим ключом сразу потеряет доступ. Вернуть ключ нельзя, можно выдать новый.'))) { await api(`tokens/${r.id}`, { method: 'DELETE' }); refresh() } }}><X /> {t('Отозвать')}</Button>} />)}
        </List>
      </Section>
      <details className="min-w-0">
        <summary className="cursor-pointer text-base font-medium">{t('Для разработчиков')}</summary>
        <div className="mt-2 flex min-w-0 flex-col gap-2.5">
          <p className="text-xs leading-snug text-ink-soft">{t('Адреса для тех, кто подключается к архиву напрямую.')}</p>
        <CopyField label={t('Адрес MCP')} value={`${origin}/api/mcp`} />
        <div className="flex min-w-0 flex-col gap-1">
          <CopyField label={t('Описание API в формате OpenAPI')} value={`${origin}/api/v1/openapi.json`} />
          <Button asChild size="sm" variant="ghost" className="self-start"><a href="/api/v1/openapi.json" target="_blank" rel="noreferrer"><ExternalLink /> {t('Открыть описание')}</a></Button>
        </div>
        </div>
      </details>
    </div>
  )
}
