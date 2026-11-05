'use client'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Expand, ScanFace, Trash2, UserRound, X } from 'lucide-react'
import Lightbox from 'yet-another-react-lightbox'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import 'yet-another-react-lightbox/styles.css'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { api, mediaUrl, useApp, useWrite } from '@/lib/client'
import { findFaces, squareCrop } from '@/lib/faces'
import { cn } from '@/lib/utils'
import { personName, type Box, type Media } from '@/lib/types'
import { Mini, PersonPopover } from './person-pickers'

export function PhotoDialog({ state, onClose }: { state: { id: string; list?: string[] } | null; onClose: () => void }) {
  const [index, setIndex] = useState(0)
  useEffect(() => setIndex(state?.list ? Math.max(0, state.list.indexOf(state.id)) : 0), [state])
  const id = state?.list ? state.list[index] ?? state.id : state?.id
  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[min(1120px,calc(100vw-32px))] sm:max-w-[min(1120px,calc(100vw-32px))] p-0 overflow-hidden gap-0" showCloseButton={false}>
        {id && <Photo key={id} id={id} list={state?.list} index={index} setIndex={setIndex} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function Photo({ id, list, index, setIndex, onClose }: { id: string; list?: string[]; index: number; setIndex: (i: number) => void; onClose: () => void }) {
  const { t, canEdit, byId, focus, confirm } = useApp()
  const qc = useQueryClient()
  const { data: m } = useQuery({ queryKey: ['photo', id], queryFn: () => api<Media>(`media/${id}`) })
  const refresh = [['photo', id], ['media']]
  const img = useRef<HTMLImageElement>(null)
  const [draft, setDraft] = useState<Box | null>(null)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const [pick, setPick] = useState<Box | null>(null)
  const [faces, setFaces] = useState<Box[]>([])
  const [scan, setScan] = useState<'' | 'busy' | 'none' | 'error'>('')
  const [full, setFull] = useState(false)
  const [hot, setHot] = useState<string | null>(null)

  const addTag = useWrite(({ personId, box }: { personId: string; box: Box | null }) => api(`media/${id}/tags`, { json: { personId, box } }), refresh)
  const delTag = useWrite((tagId: string) => api(`tags/${tagId}`, { method: 'DELETE' }), refresh)
  const avatar = useWrite(({ personId, crop }: { personId: string; crop: Box }) => api(`persons/${personId}/avatar`, { method: 'PUT', json: { mediaId: id, crop } }))
  const meta = useWrite((p: Partial<Media>) => api(`media/${id}`, { method: 'PATCH', json: p }), refresh)
  const del = useWrite(() => api(`media/${id}`, { method: 'DELETE' }), refresh)

  const frac = (e: React.PointerEvent) => {
    const r = img.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }

  const scanFaces = async () => {
    setScan('busy')
    try {
      const found = (await findFaces(img.current!)).filter((f) => !m?.tags.some((tag) => tag.x !== null && overlap(f, tag as Box) > 0.3))
      setFaces(found)
      setScan(found.length ? '' : 'none')
    } catch (e) {
      console.error(e)
      setScan('error')
    }
  }

  if (!m) return <div className="h-96" />
  const boxes = m.tags.filter((tag) => tag.x !== null)

  return (
    <div className="grid md:grid-cols-[1fr_280px] max-h-[calc(100vh-48px)]">
      <DialogTitle className="sr-only">{m.caption || m.originalName}</DialogTitle>
      <div className="bg-[#26221c] flex items-center justify-center relative min-h-[50vh] p-4">
        <div
          className={cn('photo-stage relative inline-block select-none', canEdit && 'cursor-crosshair touch-none')}
          onPointerDown={(e) => {
            if (!canEdit || (e.target as HTMLElement).closest('.tagbox')) return
            e.currentTarget.setPointerCapture(e.pointerId)
            setDrag(frac(e))
            setDraft(null)
          }}
          onPointerMove={(e) => {
            if (!drag) return
            const f = frac(e)
            setDraft({ x: Math.min(drag.x, f.x), y: Math.min(drag.y, f.y), w: Math.abs(f.x - drag.x), h: Math.abs(f.y - drag.y) })
          }}
          onPointerUp={() => {
            setDrag(null)
            if (draft && draft.w > 0.015 && draft.h > 0.015) setPick(draft)
            else setDraft(null)
          }}
        >
          <img ref={img} src={mediaUrl(id)} alt={m.caption} draggable={false} className="max-h-[calc(100vh-96px)] max-w-full block rounded-sm" />
          {boxes.map((tag) => {
            const p = byId.get(tag.personId)
            return (
              <div key={tag.id} className={cn('tagbox', hot === tag.id && 'show')} style={pos(tag as Box)} onClick={() => { onClose(); focus(tag.personId, { center: true }) }}>
                <span className="tagname">{p ? personName(p) || t('Скрыто') : ''}</span>
              </div>
            )
          })}
          {faces.map((f, i) => (
            <div key={i} className="tagbox suggest" style={pos(f)} onClick={() => setPick(f)}>
              <span className="tagname">{t('Кто это?')}</span>
            </div>
          ))}
          {draft && <div className="tagbox show" style={pos(draft)} />}
        </div>
        {list && list.length > 1 && (
          <>
            <button className="absolute left-2 top-1/2 -translate-y-1/2 text-white/70 hover:text-white p-2" onClick={() => setIndex((index - 1 + list.length) % list.length)}><ChevronLeft /></button>
            <button className="absolute right-2 top-1/2 -translate-y-1/2 text-white/70 hover:text-white p-2" onClick={() => setIndex((index + 1) % list.length)}><ChevronRight /></button>
          </>
        )}
      </div>

      <div className="flex flex-col p-4 gap-3 text-sm overflow-auto">
        <div className="flex justify-end -mt-1 -mr-1 gap-0.5">
          <button className="bar-btn !p-0 w-7 !h-7" title={t('На весь экран')} onClick={() => setFull(true)}><Expand size={14} /></button>
          {canEdit && <button className="bar-btn !p-0 w-7 !h-7" title={t('Удалить')} onClick={async () => { if (await confirm(t('Удалить это фото? Отменить можно в «Истории».'), t('Удалить'))) { await del.mutateAsync(); qc.invalidateQueries({ queryKey: ['pages'] }); onClose() } }}><Trash2 size={14} /></button>}
          <button className="bar-btn !p-0 w-7 !h-7" title={t('Закрыть')} onClick={onClose}><X size={15} /></button>
        </div>
        <MetaField readOnly={!canEdit} className="font-serif text-base" placeholder={t('Подпись')} value={m.caption} onSave={(caption) => meta.mutate({ caption })} />
        <div className="flex gap-2 text-ink-soft">
          <MetaField readOnly={!canEdit} placeholder={t('например: 1978')} value={m.date} onSave={(date) => meta.mutate({ date })} />
          <MetaField readOnly={!canEdit} placeholder={t('например: Пермь')} value={m.place} onSave={(place) => meta.mutate({ place })} />
        </div>

        <div className="flex flex-col gap-1">
          {m.tags.map((tag) => {
            const p = byId.get(tag.personId)
            if (!p) return null
            return (
              <div key={tag.id} onMouseEnter={() => setHot(tag.id)} onMouseLeave={() => setHot(null)} className="group flex items-center gap-2 rounded-md hover:bg-muted px-1 py-0.5">
                <button className="flex items-center gap-2 min-w-0 flex-1 text-left" onClick={() => { onClose(); focus(p.id, { center: true }) }}>
                  <Mini person={p} /> <span className="truncate">{personName(p) || t('Скрыто')}</span>
                </button>
                {canEdit && tag.x !== null && <button title={t('Сделать аватаркой')} className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity text-ink-faint hover:text-ink" onClick={() => avatar.mutate({ personId: p.id, crop: squareCrop(tag as Box, m.width, m.height) })}><UserRound size={14} /></button>}
                {canEdit && <button title={t('Удалить')} className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity text-ink-faint hover:text-destructive" onClick={() => delTag.mutate(tag.id)}><X size={14} /></button>}
              </div>
            )
          })}
        </div>

        {canEdit && (
          <>
            <PersonPopover
              open={!!pick}
              onOpenChange={(o) => { if (!o) { setPick(null); setDraft(null) } }}
              exclude={m.tags.filter((tag) => tag.x !== null).map((tag) => tag.personId)}
              onPick={(personId) => {
                addTag.mutate({ personId, box: pick })
                setFaces((f) => f.filter((x) => x !== pick))
                setDraft(null)
                setPick(null)
              }}
            >
              <span className="text-xs text-ink-faint">{t('Обведите лицо на фото, чтобы отметить человека')}</span>
            </PersonPopover>
            <button className="bar-btn border border-border self-start" disabled={scan === 'busy'} onClick={scanFaces}><ScanFace size={14} /> {t('Найти лица')}{scan === 'busy' && '…'}</button>
            {scan === 'none' && <p className="text-xs text-ink-faint">{t('Лиц не найдено')}</p>}
            {scan === 'error' && <p className="text-xs text-destructive">{t('Не удалось загрузить модель распознавания')}</p>}
          </>
        )}
      </div>

      <Lightbox
        open={full}
        close={() => setFull(false)}
        plugins={[Zoom]}
        slides={(list ?? [id]).map((x) => ({ src: mediaUrl(x) }))}
        index={list ? index : 0}
        on={{ view: ({ index: i }) => list && setIndex(i) }}
        carousel={{ finite: !list || list.length < 2 }}
      />
    </div>
  )
}

const pos = (b: Box): React.CSSProperties => ({ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` })

function overlap(a: Box, b: Box) {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return (w * h) / Math.min(a.w * a.h, b.w * b.h)
}

function MetaField({ value, onSave, placeholder, className, readOnly }: { value: string; onSave: (v: string) => void; placeholder: string; className?: string; readOnly: boolean }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return <input aria-label={placeholder} className={cn('inline-input', className)} readOnly={readOnly} value={v} placeholder={readOnly ? '' : placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
}
