'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy } from 'lucide-react'
import { api, useApp } from '@/lib/client'

interface TokenRow { id: string; name: string; role: 'reader' | 'editor'; review: boolean; lastUsedAt: number | null; revokedAt: number | null; expiresAt: number | null }

type Client = 'claude' | 'json' | 'prompt'

const CLIENTS: Record<Client, string> = { claude: 'Claude Code', json: 'Cursor и другие', prompt: 'Задание агенту' }

export function TokensTab() {
  const { t, lang } = useApp()
  const qc = useQueryClient()
  const { data: rows = [] } = useQuery({ queryKey: ['tokens'], queryFn: () => api<TokenRow[]>('tokens') })
  const [name, setName] = useState('')
  const [role, setRole] = useState<'reader' | 'editor'>('reader')
  const [review, setReview] = useState(true)
  const [days, setDays] = useState('')
  const [made, setMade] = useState('')
  const [copied, setCopied] = useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: ['tokens'] })
  const origin = typeof location === 'undefined' ? '' : location.origin
  const [client, setClient] = useState<Client>('claude')
  const snippet = client === 'claude'
    ? `claude mcp add --transport http family ${origin}/api/mcp --header "Authorization: Bearer ${made}"`
    : client === 'json'
      ? JSON.stringify({ mcpServers: { family: { type: 'http', url: `${origin}/api/mcp`, headers: { Authorization: `Bearer ${made}` } } } }, null, 2)
      : t('Подключись к семейному архиву по MCP. Сначала вызови get_overview, затем find_gaps. Прежде чем создавать человека, ищи его через search_people. Каждое найденное значение записывай через add_version с источником и его достоверностью, а не перезаписывай поля.')
  const fmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' })
  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-xs text-ink-soft">{t('Подключение других программ к архиву. Обычно это не нужно.')}</p>
      <form className="flex flex-col gap-2" onSubmit={async (e) => {
        e.preventDefault()
        if (!name.trim()) return
        const r = await api<{ token: string }>('tokens', { json: { name: name.trim(), role, review, expiresInDays: days ? Number(days) : null } })
        setMade(r.token)
        setCopied(false)
        setName('')
        refresh()
      }}>
                <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-1">
          <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Название ключа')}
            <input className="h-9 min-w-0 rounded-lg border border-input bg-white px-3 text-sm text-ink" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Что сможет делать')}
            <select className="h-9 rounded-lg border border-input bg-white px-2 text-sm text-ink" value={role} onChange={(e) => setRole(e.target.value as 'reader' | 'editor')}>
              <option value="reader">{t('читатель')}</option>
              <option value="editor">{t('редактор')}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Срок действия')}
            <select className="h-9 rounded-lg border border-input bg-white px-2 text-sm text-ink" value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="">{t('бессрочно')}</option>
              <option value="1">{t('на день')}</option>
              <option value="30">{t('на месяц')}</option>
              <option value="365">{t('на год')}</option>
            </select>
          </label>
        </div>
        <button className="h-9 self-start px-3 rounded-lg bg-ink text-white whitespace-nowrap disabled:opacity-40" disabled={!name.trim()}>{t('Создать ключ доступа')}</button>
        {role === 'editor' && <label className="flex items-center gap-2 text-ink-soft"><input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} /> {t('Правки через проверку')}</label>}
        <p className="text-xs text-ink-soft">{t(role === 'editor' ? 'Ключ редактора видит живых родственников, и эти данные уйдут к поставщику нейросети.' : 'Ключ только для чтения не видит живых родственников.')}</p>
      </form>
      {made && (
        <div className="rounded-lg bg-muted p-2 flex flex-col gap-1.5">
          <p className="text-xs text-ink-soft">{t('Ключ показан один раз, сохраните его.')}</p>
          <div role="radiogroup" aria-label={t('Куда подключить')} className="inline-flex self-start rounded-lg bg-background p-0.5 gap-0.5 text-xs">
            {(Object.keys(CLIENTS) as Client[]).map((c) => <button key={c} type="button" role="radio" aria-checked={client === c} className={client === c ? 'h-7 px-2 rounded-md bg-white shadow-sm font-medium' : 'h-7 px-2 rounded-md text-ink-soft hover:text-ink'} onClick={() => { setClient(c); setCopied(false) }}>{t(CLIENTS[c])}</button>)}
          </div>
          <code className="text-xs break-all whitespace-pre-wrap">{snippet}</code>
          <button className="flex items-center gap-1 text-xs text-ink-soft hover:text-ink self-start" onClick={() => { navigator.clipboard.writeText(snippet); setCopied(true) }}>{copied ? <Check size={13} /> : <Copy size={13} />}{t(copied ? 'Скопировано' : 'Скопировать')}</button>
        </div>
      )}
      <section>
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-2 py-1">
            <span className="truncate flex-1">{r.name}</span>
            <span className="text-xs text-ink-faint whitespace-nowrap">
              {t(r.role === 'reader' ? 'читатель' : r.review ? 'Правки через проверку' : 'Правит сразу')}
              {r.lastUsedAt ? ` · ${t('последнее использование')} ${fmt.format(r.lastUsedAt)}` : ''}
              {r.expiresAt ? ` · ${t(r.expiresAt < Date.now() ? 'истёк' : 'действует до')} ${fmt.format(r.expiresAt)}` : ''}
            </span>
            {r.revokedAt ? <span className="text-xs text-ink-faint">{t('Отозван')}</span> : <button className="text-xs text-ink-soft hover:text-destructive" onClick={async () => { await api(`tokens/${r.id}`, { method: 'DELETE' }); refresh() }}>{t('Отменить')}</button>}
          </div>
        ))}
      </section>
      <p className="text-xs"><a className="underline" href="/api/v1/openapi.json" target="_blank">{t('Описание для разработчиков')}</a></p>
    </div>
  )
}
