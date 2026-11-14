'use client'
import { translate } from '@/lib/i18n'
import { pageLang } from '@/lib/languages'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BlockNoteSchema, defaultInlineContentSpecs } from '@blocknote/core'
import { filterSuggestionItems } from '@blocknote/core/extensions'
import { ru, en, es } from '@blocknote/core/locales'
import { createReactInlineContentSpec, SuggestionMenuController, useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { api, useApp } from '@/lib/client'
import { autosave, clearDraft, loadDraft, type SaveStatus } from '@/lib/autosave'
import { decorateBlocks } from '@/lib/linkify'
import { personName, shownTags, type Media, type Page } from '@/lib/types'
import { GrowText, ReadText } from './person-fields'
import { inputClass } from '@/components/ui/input'

const Mention = createReactInlineContentSpec(
  { type: 'mention', propSchema: { personId: { default: '' }, label: { default: '' } }, content: 'none' } as const,
  {
    render: (props) => (
      <span className="mention-chip" data-mention={props.inlineContent.props.personId}><span className="mention-at">@</span>{props.inlineContent.props.label}</span>
    ),
  },
)

/** A mark on a paragraph: nobody has checked this yet. */
const Unverified = createReactInlineContentSpec(
  { type: 'unverified', propSchema: {}, content: 'none' } as const,
  { render: () => <span className="mark-chip unverified">⚠ {translate(typeof document !== 'undefined' ? pageLang() : 'ru', 'не проверено')}</span> },
)

/** A link from a paragraph to one of this person's sources. */
const Citation = createReactInlineContentSpec(
  { type: 'citation', propSchema: { sourceId: { default: '' }, label: { default: '' } }, content: 'none' } as const,
  { render: (props) => <span className="mark-chip" data-citation={props.inlineContent.props.sourceId}>{props.inlineContent.props.label}</span> },
)

const TAG_COLORS = 6
/** The same tag keeps its colour everywhere. */
const tagColor = (name: string) => [...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % TAG_COLORS

/** A #tag in the text; it also joins the person's groups, so the chart can filter by it. */
const Tag = createReactInlineContentSpec(
  { type: 'tag', propSchema: { name: { default: '' } }, content: 'none' } as const,
  { render: (props) => <span className={`tag-chip tag-${tagColor(props.inlineContent.props.name)}`}>{props.inlineContent.props.name}</span> },
)

const schema = BlockNoteSchema.create({ inlineContentSpecs: { ...defaultInlineContentSpecs, mention: Mention, unverified: Unverified, citation: Citation, tag: Tag } })

export default function PageEditor({ pageId, personId, onChanged }: { pageId: string; personId: string; onChanged: () => void }) {
  const { data: page } = useQuery({ queryKey: ['page', pageId], queryFn: () => api<Page>(`pages/${pageId}`), staleTime: Infinity, gcTime: 0 })
  if (!page) return <div className="h-40" />
  return <Editor key={page.updatedAt} page={page} personId={personId} onChanged={onChanged} />
}

function Editor({ page, personId, onChanged }: { page: Page; personId: string; onChanged: () => void }) {
  const { t, canEdit, lang, graph, focus, openPhoto, notify, me } = useApp()
  const qc = useQueryClient()
  // Text that never reached the server comes back, whatever happened to the last tab.
  const [draft] = useState(() => {
    const kept = canEdit ? loadDraft(page.id, me.id) : null
    if (!kept) return null
    if (kept.title === page.title && JSON.stringify(kept.content) === JSON.stringify(JSON.parse(page.content))) {
      clearDraft(page.id)
      return null
    }
    return kept
  })
  const [title, setTitle] = useState(draft?.title ?? page.title)
  const [status, setStatus] = useState<SaveStatus>('')
  const initial = useMemo(() => {
    const blocks = (draft?.content as unknown[] | undefined) ?? JSON.parse(page.content)
    return blocks.length ? (decorateBlocks(blocks) as never) : undefined
  }, [page.content, draft])

  const editor = useCreateBlockNote({
    schema,
    initialContent: initial,
    // BlockNote has no Catalan: a Catalan page editor reads in English.
    dictionary: { ru, en, es, ca: en }[lang],
    uploadFile: async (file: File) => {
      const form = new FormData()
      form.set('file', file)
      form.set('personId', personId)
      const m = await api<Media>('media', { body: form })
      qc.invalidateQueries({ queryKey: ['media', personId] })
      return `/api/v1/media/${m.id}/file${m.kind === 'image' ? '?size=medium' : ''}`
    },
  })

  const latestTitle = useRef(draft?.title ?? page.title)
  const savedTitle = useRef(page.title)
  const saver = useRef<ReturnType<typeof autosave>>(null)
  saver.current ??= autosave({
    id: page.id,
    user: me.id,
    base: draft?.base ?? page.updatedAt,
    read: () => ({ title: latestTitle.current, content: editor.document }),
    send: async (text, base) => {
      const { updatedAt } = await api<{ updatedAt: number }>(`pages/${page.id}`, { method: 'PATCH', json: { ...text, ...(base === null ? {} : { baseUpdatedAt: base }) } })
      qc.invalidateQueries({ queryKey: ['history'] })
      if (text.title !== savedTitle.current) { savedTitle.current = text.title; onChanged() }
      return updatedAt
    },
    onStatus: setStatus,
  })
  const schedule = () => saver.current!.change()
  useEffect(() => {
    const s = saver.current!
    if (draft) { s.change(); notify(t('Восстановлен несохранённый текст')) }
    const online = () => s.retry()
    // The tab is going away. The browser keeps the text; a short one can also still reach the server.
    const hide = () => {
      const text = s.hide()
      if (!text || !navigator.onLine) return
      const body = JSON.stringify({ title: text.title, content: text.content, baseUpdatedAt: text.base })
      if (body.length < 60_000) void fetch(`/api/v1/pages/${page.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
    }
    const warn = (e: BeforeUnloadEvent) => { if (s.unsent()) e.preventDefault() }
    window.addEventListener('online', online)
    window.addEventListener('pagehide', hide)
    window.addEventListener('beforeunload', warn)
    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('pagehide', hide)
      window.removeEventListener('beforeunload', warn)
      // Leaving a page must not lose the last keystrokes.
      s.close()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const people = useMemo(() => graph.persons.filter((p) => !p.hidden), [graph])
  const person = graph.persons.find((p) => p.id === personId)
  const sources = person?.sources ?? []
  const [picking, setPicking] = useState(false)
  const [newSource, setNewSource] = useState('')
  // The marks are for someone writing; someone reading gets the text alone.
  const [writing, setWriting] = useState(false)
  const [marked, setMarked] = useState(false)

  // Without focus the editor answers with its first block, so the paragraph is remembered here.
  const lastBlock = useRef<string | null>(null)
  /** Marks go at the end of the paragraph the cursor was last in. */
  const currentBlock = () => {
    const block = lastBlock.current ? editor.getBlock(lastBlock.current) : undefined
    if (block && Array.isArray(block.content)) return block
    notify(t('Поставьте курсор в нужный абзац'))
    return null
  }
  const toggleUnverified = () => {
    const block = currentBlock()
    if (!block) return
    const content = block.content as { type: string }[]
    const next = content.some((c) => c.type === 'unverified') ? content.filter((c) => c.type !== 'unverified') : [...content, { type: 'text', text: ' ', styles: {} }, { type: 'unverified', props: {} }]
    editor.updateBlock(block, { content: next } as never)
    setMarked(!content.some((c) => c.type === 'unverified'))
  }
  const cite = (sourceId: string, label: string) => {
    const block = currentBlock()
    setPicking(false)
    if (!block) return
    editor.updateBlock(block, { content: [...(block.content as object[]), { type: 'text', text: ' ', styles: {} }, { type: 'citation', props: { sourceId, label } }] } as never)
  }
  const addTag = (name: string) => {
    editor.insertInlineContent([{ type: 'tag', props: { name } }, ' '])
    if (!person || person.tags.includes(name)) return
    api(`persons/${person.id}`, { method: 'PATCH', json: { tags: [...person.tags, name] } }).then(() => qc.invalidateQueries({ queryKey: ['graph'] })).catch(() => notify(t('Не удалось сохранить')))
  }
  const createSource = async () => {
    const title = newSource.trim()
    if (!title || !person) return
    const id = Math.random().toString(36).slice(2, 10)
    await api(`persons/${person.id}`, { method: 'PATCH', json: { sources: [...sources, { id, title, ref: '', page: '', url: '', reliability: 'copy' }] } })
    qc.invalidateQueries({ queryKey: ['graph'] })
    setNewSource('')
    cite(id, title)
  }

  return (
    <div
      className={canEdit ? '' : 'page-read'}
      onFocusCapture={() => setWriting(true)}
      onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setWriting(false) }}
      onClick={(e) => {
        const el = e.target as HTMLElement
        const mention = el.closest<HTMLElement>('[data-mention]')?.dataset.mention
        if (mention) focus(mention, { center: true })
        const cited = sources.find((s) => s.id === el.closest<HTMLElement>('[data-citation]')?.dataset.citation)
        if (cited && /^https?:\/\//.test(cited.url)) window.open(cited.url, '_blank', 'noopener,noreferrer')
        const href = el.closest<HTMLAnchorElement>('.bn-editor a')?.href
        if (href && /^https?:\/\//.test(href)) {
          e.preventDefault()
          window.open(href, '_blank', 'noopener,noreferrer')
        }
      }}
      onDoubleClick={(e) => {
        // The photo in the text is the same file with the same tags, so it opens the same viewer.
        const img = (e.target as HTMLElement).closest('img')
        const id = img?.getAttribute('src')?.match(/\/api\/v1\/media\/([^/]+)\/file/)?.[1]
        if (id) openPhoto(id)
      }}
    >
      <div className={`font-serif text-[20px] font-medium pb-1 leading-snug ${canEdit ? 'pl-14 pr-5 [@media(hover:none)]:px-4' : 'px-4'}`}>
        {canEdit
          ? <GrowText value={title} aria-label={t('Название')} placeholder={t('Без названия')} onChange={(e) => { setTitle(e.target.value); latestTitle.current = e.target.value; schedule() }} onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }} />
          : <ReadText value={title} />}
      </div>
      <BlockNoteView
        editor={editor}
        editable={canEdit}
        theme="light"
        slashMenu
        onChange={schedule}
        onSelectionChange={() => {
          if (!editor.isFocused()) return
          const block = editor.getTextCursorPosition().block
          lastBlock.current = block.id
          setMarked(Array.isArray(block.content) && (block.content as { type: string }[]).some((c) => c.type === 'unverified'))
        }}
      >
        <SuggestionMenuController
          triggerCharacter="#"
          getItems={async (query) => {
            const known = [...new Set(graph.persons.flatMap((p) => shownTags(p.tags)))].sort()
            const fresh = query.trim() && !known.some((x) => x.toLowerCase() === query.trim().toLowerCase()) ? [query.trim()] : []
            return [...filterSuggestionItems(known.map((name) => ({ title: name, onItemClick: () => addTag(name) })), query), ...fresh.map((name) => ({ title: `${t('Новый тег')}: ${name}`, onItemClick: () => addTag(name) }))]
          }}
        />
        <SuggestionMenuController
          triggerCharacter="@"
          getItems={async (query) =>
            filterSuggestionItems(
              people.map((p) => ({
                title: personName(p) || t('Без названия'),
                onItemClick: () => editor.insertInlineContent([{ type: 'mention', props: { personId: p.id, label: personName(p) } }, ' ']),
              })),
              query,
            )
          }
        />
      </BlockNoteView>
      {canEdit && (writing || picking) && (
        <div className="sticky bottom-0 z-10 border-t border-border bg-[#fffdf8] flex flex-wrap items-center gap-1.5 px-4 py-1.5 text-xs" onMouseDown={(e) => { if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault() }}>
          <span className="text-ink-faint">{t('Отметить абзац')}:</span>
          <button className="pick rounded-full border border-border px-2.5 h-7 text-ink-soft hover:text-ink" onClick={toggleUnverified}>{marked ? `✓ ${t('Не проверено')}` : `⚠ ${t('Не проверено')}`}</button>
          <Popover open={picking} onOpenChange={setPicking}>
            <PopoverTrigger asChild><button className="pick rounded-full border border-border px-2.5 h-7 text-ink-soft hover:text-ink">🔗 {t('Источник')}</button></PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-2 text-sm flex flex-col gap-1" onOpenAutoFocus={(e) => e.preventDefault()} onCloseAutoFocus={(e) => e.preventDefault()}>
              {sources.filter((s) => s.id).map((s) => <button key={s.id} className="text-left rounded px-2 py-1.5 hover:bg-muted break-anywhere" onMouseDown={(e) => e.preventDefault()} onClick={() => cite(s.id!, s.title || t('Без названия'))}>{s.title || t('Без названия')}</button>)}
              {!sources.some((s) => s.id) && <p className="px-2 py-1 text-xs text-ink-faint">{t('У этого человека пока нет источников')}</p>}
              <form className="flex gap-1 pt-1 border-t border-border" onSubmit={(e) => { e.preventDefault(); createSource() }}>
                <input value={newSource} onChange={(e) => setNewSource(e.target.value)} placeholder={t('Новый источник')} aria-label={t('Новый источник')} className={`${inputClass} flex-1`} />
                <button className="bar-btn border border-border flex-none" disabled={!newSource.trim()}>{t('Добавить')}</button>
              </form>
            </PopoverContent>
          </Popover>
        </div>
      )}
      {status === 'waiting' && <p role="status" className="px-9 text-xs text-destructive">{t('Нет связи. Текст сохранён в этом браузере и отправится сам, когда связь вернётся')}</p>}
      {status === 'failed' && <p role="alert" className="px-9 text-xs text-destructive">{t('Не удалось сохранить')}. {t('Текст остался в этом браузере')}</p>}
      {status === 'conflict' && (
        <div role="alert" className="mx-[54px] mt-1 rounded-md border border-destructive/40 p-2 text-xs">
          <p>{t('Эту страницу уже изменили в другом окне или другой человек. Какой текст оставить?')}</p>
          <div className="mt-1.5 flex gap-2">
            <button className="underline" onClick={() => { saver.current!.discard(); setStatus(''); qc.invalidateQueries({ queryKey: ['page', page.id] }) }}>{t('Показать новый, мой убрать')}</button>
            <button className="underline" onClick={() => saver.current!.overwrite()}>{t('Оставить мой')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
