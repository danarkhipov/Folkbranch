'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BlockNoteSchema, defaultInlineContentSpecs } from '@blocknote/core'
import { filterSuggestionItems } from '@blocknote/core/extensions'
import { ru, en } from '@blocknote/core/locales'
import { createReactInlineContentSpec, SuggestionMenuController, useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { api, useApp } from '@/lib/client'
import { personName, type Media, type Page } from '@/lib/types'

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
  { render: () => <span className="mark-chip unverified">⚠ не проверено</span> },
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
  const { t, canEdit, lang, graph, focus, openPhoto, notify } = useApp()
  const qc = useQueryClient()
  const [title, setTitle] = useState(page.title)
  const [status, setStatus] = useState<'' | 'saved' | 'error'>('')
  const initial = useMemo(() => {
    const blocks = JSON.parse(page.content)
    return blocks.length ? blocks : undefined
  }, [page.content])

  const editor = useCreateBlockNote({
    schema,
    initialContent: initial,
    dictionary: lang === 'en' ? en : ru,
    uploadFile: async (file: File) => {
      const form = new FormData()
      form.set('file', file)
      form.set('personId', personId)
      const m = await api<Media>('media', { body: form })
      qc.invalidateQueries({ queryKey: ['media', personId] })
      return `/api/v1/media/${m.id}/file${m.kind === 'image' ? '?size=medium' : ''}`
    },
  })

  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const dirty = useRef(false)
  const latestTitle = useRef(page.title)
  const save = async () => {
    clearTimeout(timer.current)
    if (!dirty.current) return
    dirty.current = false
    const renamed = latestTitle.current !== page.title
    try {
      await api(`pages/${page.id}`, { method: 'PATCH', json: { title: latestTitle.current, content: editor.document } })
      setStatus('saved')
      qc.invalidateQueries({ queryKey: ['history'] })
      if (renamed) onChanged()
    } catch {
      setStatus('error')
    }
  }
  const schedule = () => {
    dirty.current = true
    clearTimeout(timer.current)
    timer.current = setTimeout(save, 700)
  }
  // Leaving a page must not lose the last keystrokes.
  useEffect(() => () => void save(), []) // eslint-disable-line react-hooks/exhaustive-deps

  const people = useMemo(() => graph.persons.filter((p) => !p.hidden), [graph])
  const person = graph.persons.find((p) => p.id === personId)
  const sources = person?.sources ?? []
  const [picking, setPicking] = useState(false)
  const [newSource, setNewSource] = useState('')

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
      <input
        className="w-full bg-transparent outline-none font-serif text-[26px] font-medium px-[54px] pb-2 placeholder:text-ink-faint"
        value={title}
        readOnly={!canEdit}
        placeholder={t('Без названия')}
        onChange={(e) => {
          setTitle(e.target.value)
          latestTitle.current = e.target.value
          schedule()
        }}
      />
      {canEdit && (
        <div className="sticky top-0 z-10 bg-[#fffdf8] flex flex-wrap items-center gap-1.5 px-[54px] py-1.5 text-xs" onMouseDown={(e) => { if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault() }}>
          <span className="text-ink-faint">{t('К этому абзацу')}:</span>
          <button className="pick rounded-full border border-border px-2.5 h-7 text-ink-soft hover:text-ink" onClick={toggleUnverified}>⚠ {t('Не проверено')}</button>
          <Popover open={picking} onOpenChange={setPicking}>
            <PopoverTrigger asChild><button className="pick rounded-full border border-border px-2.5 h-7 text-ink-soft hover:text-ink">🔗 {t('Источник')}</button></PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-2 text-[13px] flex flex-col gap-1" onOpenAutoFocus={(e) => e.preventDefault()} onCloseAutoFocus={(e) => e.preventDefault()}>
              {sources.filter((s) => s.id).map((s) => <button key={s.id} className="text-left rounded px-2 py-1.5 hover:bg-muted truncate" onMouseDown={(e) => e.preventDefault()} onClick={() => cite(s.id!, s.title || t('Без названия'))}>{s.title || t('Без названия')}</button>)}
              {!sources.some((s) => s.id) && <p className="px-2 py-1 text-xs text-ink-faint">{t('У этого человека пока нет источников')}</p>}
              <form className="flex gap-1 pt-1 border-t border-border" onSubmit={(e) => { e.preventDefault(); createSource() }}>
                <input value={newSource} onChange={(e) => setNewSource(e.target.value)} placeholder={t('Новый источник')} aria-label={t('Новый источник')} className="h-8 min-w-0 flex-1 rounded-md border border-input bg-white px-2" />
                <button className="bar-btn border border-border flex-none" disabled={!newSource.trim()}>{t('Добавить')}</button>
              </form>
            </PopoverContent>
          </Popover>
        </div>
      )}
      <BlockNoteView
        editor={editor}
        editable={canEdit}
        theme="light"
        slashMenu
        onChange={schedule}
        onSelectionChange={() => { if (editor.isFocused()) lastBlock.current = editor.getTextCursorPosition().block.id }}
      >
        <SuggestionMenuController
          triggerCharacter="#"
          getItems={async (query) => {
            const known = [...new Set(graph.persons.flatMap((p) => p.tags))].sort()
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
      {status === 'error' && <p className="px-[54px] text-xs text-destructive">{t('Не удалось сохранить')}</p>}
    </div>
  )
}
