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
import { api, useApp } from '@/lib/client'
import { personName, type Media, type Page } from '@/lib/types'

const Mention = createReactInlineContentSpec(
  { type: 'mention', propSchema: { personId: { default: '' }, label: { default: '' } }, content: 'none' } as const,
  {
    render: (props) => (
      <span className="mention-chip" data-mention={props.inlineContent.props.personId}>@{props.inlineContent.props.label}</span>
    ),
  },
)

const schema = BlockNoteSchema.create({ inlineContentSpecs: { ...defaultInlineContentSpecs, mention: Mention } })

export default function PageEditor({ pageId, personId, onChanged }: { pageId: string; personId: string; onChanged: () => void }) {
  const { data: page } = useQuery({ queryKey: ['page', pageId], queryFn: () => api<Page>(`pages/${pageId}`), staleTime: Infinity, gcTime: 0 })
  if (!page) return <div className="h-40" />
  return <Editor key={page.updatedAt} page={page} personId={personId} onChanged={onChanged} />
}

function Editor({ page, personId, onChanged }: { page: Page; personId: string; onChanged: () => void }) {
  const { t, canEdit, lang, graph, focus, openPhoto } = useApp()
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

  return (
    <div
      onClick={(e) => {
        const el = e.target as HTMLElement
        const mention = el.closest<HTMLElement>('[data-mention]')?.dataset.mention
        if (mention) focus(mention, { center: true })
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
      <BlockNoteView
        editor={editor}
        editable={canEdit}
        theme="light"
        slashMenu
        onChange={schedule}
      >
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
