'use client'
import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, mediaUrl, useApp, useWrite } from '@/lib/client'
import { type Media, type Person } from '@/lib/types'

export function PhotosTab({ person }: { person: Person }) {
  const { t, canEdit, openPhoto } = useApp()
  const { data: photos = [] } = useQuery({ queryKey: ['media', person.id], queryFn: () => api<Media[]>(`persons/${person.id}/media`) })
  const input = useRef<HTMLInputElement>(null)
  const upload = useWrite(async (files: File[]) => {
    let last: Media | null = null
    for (const f of files) {
      const form = new FormData()
      form.set('file', f)
      form.set('personId', person.id)
      last = await api<Media>('media', { body: form })
    }
    return last
  }, [['media', person.id]])
  const images = photos.filter((m) => m.kind === 'image')
  return (
    <div className="px-4 py-4">
      {canEdit && (
        <>
          <button className="add-btn mb-3" disabled={upload.isPending} aria-busy={upload.isPending} onClick={() => input.current?.click()}>{t('Загрузить фото')}</button>
          <input ref={input} type="file" accept="image/*" multiple hidden onChange={async (e) => {
            const last = await upload.mutateAsync([...(e.target.files ?? [])])
            e.target.value = ''
            if (last) openPhoto(last.id)
          }} />
        </>
      )}
      {!images.length && <p className="text-ink-faint text-sm">{t('Добавьте первое фото: снимки помогают узнать человека')}</p>}
      <div className="grid grid-cols-3 gap-2">
        {images.map((m) => (
          <button key={m.id} className="min-w-0 text-left hover:opacity-90 transition" onClick={() => openPhoto(m.id, images.map((i) => i.id))}>
            <img src={mediaUrl(m.id, 'thumb')} alt={m.caption} className="aspect-square w-full rounded-md bg-muted object-cover" loading="lazy" />
            {m.caption && <span className="mt-0.5 block text-xs text-ink-soft line-clamp-2 break-anywhere" title={m.caption}>{m.caption}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
