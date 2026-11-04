'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, FilePlus2, Maximize2, Minimize2, Plus, Trash2, UserCheck, X } from 'lucide-react'
import Cropper from 'react-easy-crop'
import 'react-easy-crop/react-easy-crop.css'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, avatarUrl, mediaUrl, useApp, useWrite } from '@/lib/client'
import { yourTerm } from '@/lib/kinship'
import { ageWords, patronymicFrom } from '@/lib/names'
import { cn } from '@/lib/utils'
import { personName, type Certainty, type Fact, type Media, type PageMeta, type Person, type Union } from '@/lib/types'
import { Mini, useEsc } from './person-pickers'

const PageEditor = dynamic(() => import('./page-editor'), { ssr: false, loading: () => <div className="h-40" /> })

function Field({ value, onSave, placeholder, className, readOnly, id, list }: { value: string; onSave: (v: string) => void; placeholder?: string; className?: string; readOnly?: boolean; id?: string; list?: string }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <input
      id={id}
      list={list}
      className={cn('inline-input', className)}
      value={v}
      aria-label={placeholder}
      placeholder={readOnly ? '' : placeholder}
      readOnly={readOnly}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v)}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  )
}

export function PersonPanel({ person, onClose, onDelete }: { person: Person; onClose: () => void; onDelete: (id: string) => void }) {
  const app = useApp()
  const { t, canEdit, me, family, lang, graph, byId } = app
  const [full, setFull] = useState(false)
  useEsc(onClose)
  const patch = useWrite((p: Partial<Person>) => api(`persons/${person.id}`, { method: 'PATCH', json: p }))
  const claim = useWrite((personId: string | null) => api('me', { method: 'PATCH', json: { personId } }).then(() => location.reload()))
  const save = (key: keyof Person) => (v: string) => patch.mutate({ [key]: v })
  const { data: pageList } = useQuery({ queryKey: ['pages', person.id], queryFn: () => api<PageMeta[]>(`persons/${person.id}/pages`) })
  const { data: photos = [] } = useQuery({ queryKey: ['media', person.id], queryFn: () => api<Media[]>(`persons/${person.id}/media`) })
  const [tab, setTab] = useState<string | null>(null)
  /** Opens a tab and, when given, puts the cursor in that field. */
  const go = (next: string, fieldId?: string) => {
    setTab(next)
    if (fieldId) setTimeout(() => document.getElementById(fieldId)?.focus(), 60)
  }
  const father = graph.parentChild.filter((l) => l.childId === person.id && l.kind === 'birth').map((l) => byId.get(l.parentId)).find((p) => p?.sex === 'M')
  const suggested = canEdit && lang === 'ru' && !person.patronymic && father ? patronymicFrom(father.givenName, person.sex) : ''
  const toMe = me.personId && me.personId !== person.id ? family.relation(me.personId, person.id, lang) : null
  const ro = !canEdit

  return (
    <aside className={cn('panel', full && 'full')}>
      <div className="absolute right-3 top-3 flex gap-0.5 z-10">
        <button className="bar-btn !p-0 w-7 !h-7" aria-label={t(full ? 'Свернуть' : 'Развернуть')} title={t(full ? 'Свернуть' : 'Развернуть')} onClick={() => setFull(!full)}>{full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
        <button className="bar-btn !p-0 w-7 !h-7" aria-label={t('Закрыть')} title={t('Закрыть')} onClick={onClose}><X size={15} /></button>
      </div>

      <header className="px-6 pt-6 pb-3 flex gap-4 items-start max-sm:px-4 max-sm:pt-4 max-sm:pb-2 max-sm:gap-3">
        <AvatarButton person={person} />
        <div className="min-w-0 flex-1">
          <Field readOnly={ro} className="font-serif text-[22px] font-medium leading-tight !w-[calc(100%-56px)] max-sm:text-[19px]" value={person.givenName} placeholder={t('Имя')} onSave={save('givenName')} />
          {person.patronymic && <Field readOnly={ro} className="font-serif text-[17px] leading-tight max-sm:text-[15px]" value={person.patronymic} placeholder={t('Отчество')} onSave={save('patronymic')} />}
          <Field readOnly={ro} className="font-serif text-[22px] font-medium leading-tight max-sm:text-[19px]" value={person.surname} placeholder={t('Фамилия')} onSave={save('surname')} />
          {!person.patronymic && !ro && lang === 'ru' && (
            <div className="flex items-center text-ink-soft text-[13px] mt-0.5 gap-1.5 min-w-0">
              <span className="flex-none max-sm:text-[12px]">{t('Отчество')}:</span>
              <Field value="" placeholder={t('не указано')} className="min-w-0 flex-1" onSave={save('patronymic')} />
              {suggested && <button className="pick flex-none text-xs rounded-full bg-muted px-2 h-6 hover:text-ink" title={t('По имени отца')} onClick={() => patch.mutate({ patronymic: suggested })}>{t('Заполнить')}: {suggested}</button>}
            </div>
          )}
          {(person.maidenName || (!ro && person.sex === 'F')) && (
            <div className="flex items-baseline text-ink-soft text-[13px] mt-0.5"><span className="flex-none mr-1.5 max-sm:text-[12px]">{t('Девичья фамилия')}:</span><Field readOnly={ro} value={person.maidenName} placeholder={t('не указана')} onSave={save('maidenName')} /></div>
          )}
          {toMe && <div className="text-rust text-[13px] mt-1">{yourTerm(toMe.label, person.sex, lang)}</div>}
          {me.personId === person.id && <div className="text-rust text-[13px] mt-1">{t('Это вы')}</div>}
        </div>
      </header>

      <Tabs value={tab ?? (pageList && !pageList.length && !canEdit ? 'family' : 'pages')} onValueChange={setTab} className="flex-1 min-h-0 flex flex-col gap-0">
        <TabsList className="mx-6 max-sm:mx-4 w-fit bg-muted h-8">
          <TabsTrigger value="pages" className="text-[13px]">{t('Биография')}</TabsTrigger>
          <TabsTrigger value="details" className="text-[13px]">{t('Сведения')}</TabsTrigger>
          <TabsTrigger value="family" className="text-[13px]">{t('Семья')}</TabsTrigger>
          <TabsTrigger value="photos" className="text-[13px]">{t('Фото')}</TabsTrigger>
        </TabsList>
        <TabsContent value="pages" className="flex-1 min-h-0 overflow-hidden"><Pages person={person} full={full} onDetails={() => go('details')} /></TabsContent>
        <TabsContent value="details" className="flex-1 min-h-0 overflow-auto pt-2">
          <Details person={person} patch={(p) => patch.mutate(p)} go={go} photoCount={photos.length} pageCount={pageList?.length ?? 0} />
        </TabsContent>
        <TabsContent value="family" className="flex-1 min-h-0 overflow-auto"><FamilyTab person={person} /></TabsContent>
        <TabsContent value="photos" className="flex-1 min-h-0 overflow-auto"><PhotosTab person={person} /></TabsContent>
      </Tabs>
      {canEdit && (
        <div className="border-t border-border px-6 py-2.5 flex justify-end">
          <button className="pick text-xs text-ink-soft hover:text-destructive" onClick={() => onDelete(person.id)}>{t('Удалить человека')}</button>
        </div>
      )}
    </aside>
  )
}

const CERTAINTY: Record<Certainty, string> = { documented: 'по документу', family: 'со слов семьи', assumed: 'предположение' }

function AvatarButton({ person }: { person: Person }) {
  const { canEdit, t } = useApp()
  const input = useRef<HTMLInputElement>(null)
  const [src, setSrc] = useState<File | null>(null)
  const [srcUrl, setSrcUrl] = useState('')
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const area = useRef({ x: 0, y: 0, width: 100, height: 100 })

  const save = useWrite(async () => {
    const form = new FormData()
    form.set('file', src!)
    form.set('personId', person.id)
    const m = await api<Media>('media', { body: form })
    const a = area.current
    await api(`persons/${person.id}/avatar`, { method: 'PUT', json: { mediaId: m.id, crop: { x: a.x / 100, y: a.y / 100, w: a.width / 100, h: a.height / 100 } } })
  }, [['media', person.id]])

  return (
    <>
      <button disabled={!canEdit} aria-label={t('Выбрать фото')} title={canEdit ? t('Выбрать фото') : undefined} className="w-[96px] h-[96px] max-sm:w-[64px] max-sm:h-[64px] rounded-full overflow-hidden bg-[#e7dfcd] flex-none shadow-[0_0_0_3px_#fffdf8,0_2px_10px_rgb(60_45_20/.25)] enabled:hover:opacity-85 transition" onClick={() => input.current?.click()}>
        <img src={avatarUrl(person)} alt="" className="w-full h-full object-cover" />
      </button>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => {
        const f = e.target.files?.[0]
        if (f) { setSrc(f); setSrcUrl(URL.createObjectURL(f)); setZoom(1); setCrop({ x: 0, y: 0 }) }
        e.target.value = ''
      }} />
      <Dialog open={!!src} onOpenChange={(o) => !o && setSrc(null)}>
        <DialogContent className="max-w-md">
          <DialogTitle className="font-serif font-medium">{t('Кадрировать аватарку')}</DialogTitle>
          <div className="relative h-80 rounded-lg overflow-hidden bg-ink">
            <Cropper image={srcUrl} crop={crop} zoom={zoom} aspect={1} cropShape="round" showGrid={false} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(a) => (area.current = a)} />
          </div>
          <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoom(+e.target.value)} className="w-full accent-[var(--ink)]" />
          <div className="flex justify-end gap-2">
            <button className="bar-btn" onClick={() => setSrc(null)}>{t('Отмена')}</button>
            <button className="bar-btn on" disabled={save.isPending} onClick={async () => { await save.mutateAsync(); setSrc(null) }}>{t('Сохранить')}</button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Pages({ person, full, onDetails }: { person: Person; full: boolean; onDetails: () => void }) {
  const { t, canEdit, confirm } = useApp()
  const key = ['pages', person.id]
  const { data: pages = [] } = useQuery({ queryKey: key, queryFn: () => api<PageMeta[]>(`persons/${person.id}/pages`) })
  const [openId, setOpenId] = useState<string | null>(null)
  const selected = pages.find((p) => p.id === openId) ?? pages[0]
  const qc = useQueryClient()
  const refresh = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ['history'] }) }

  const add = async (parentPageId?: string) => {
    const p = await api<PageMeta>('pages', { json: { personId: person.id, title: '', parentPageId } })
    refresh()
    setOpenId(p.id)
  }
  const remove = async (p: PageMeta) => {
    if (await confirm(`${t('Удалить')} «${p.title || t('Без названия')}»?`, t('Удалить'))) {
      await api(`pages/${p.id}`, { method: 'DELETE' })
      if (openId === p.id) setOpenId(null)
      refresh()
    }
  }
  /** Drop on a row: top third places before, bottom third after, the middle nests inside. */
  const move = async (dragId: string, target: PageMeta, zone: 'before' | 'inside' | 'after') => {
    if (dragId === target.id) return
    const siblings = pages.filter((p) => p.parentPageId === target.parentPageId && p.id !== dragId)
    const i = siblings.findIndex((p) => p.id === target.id)
    let json: Record<string, unknown>
    if (zone === 'inside') json = { parentPageId: target.id, position: Date.now() }
    else {
      const prev = zone === 'before' ? siblings[i - 1] : target
      const next = zone === 'before' ? target : siblings[i + 1]
      const position = prev && next ? (prev.position + next.position) / 2 : prev ? prev.position + 1 : next.position - 1
      json = { parentPageId: target.parentPageId, position }
    }
    await api(`pages/${dragId}/move`, { json }).catch(() => null)
    refresh()
  }

  const tree = (
    <PageTree pages={pages} selected={selected?.id} onOpen={setOpenId} onAdd={add} onRemove={remove} onMove={move} />
  )
  return (
    <div className={cn('h-full', full ? 'grid grid-cols-[260px_1fr]' : 'flex flex-col')}>
      <div className={cn('px-4 pt-3 pb-2', full ? 'border-r border-border overflow-auto' : 'max-h-24 overflow-auto border-b border-border')}>
        {(pages.length > 1 || full) && tree}
        {canEdit && pages.length > 0 && <button className="flex items-center gap-1.5 text-ink-faint hover:text-ink text-[13px] px-2 py-1 mt-0.5" onClick={() => add()}><FilePlus2 size={14} /> {t('Новая страница')}</button>}
        {!canEdit && !pages.length && <p className="text-ink-faint text-[13px] px-2 py-1">{t('Страниц пока нет')}</p>}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {selected && <div className={cn('mx-auto py-4', full ? 'max-w-3xl px-10' : 'px-3')}><PageEditor key={selected.id} pageId={selected.id} personId={person.id} onChanged={refresh} /></div>}
        {!selected && canEdit && (
          <div className="px-6 py-8 flex flex-col items-start gap-2">
            <p className="font-serif text-[17px] text-ink">{t('Расскажите о человеке')}</p>
            <div className="flex flex-wrap gap-2">
              <button className="bar-btn on" onClick={() => add()}><FilePlus2 size={14} /> {t('Начать биографию')}</button>
              <button className="bar-btn border border-border" onClick={onDetails}>{t('Заполнить сведения')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const ICONS = ['📖', '🎖️', '✉️', '📜', '🏠', '📷', '🎓', '⚓', '🌾', '🛠️', '❤️', '🗺️']

function PageTree({ pages, selected, onOpen, onAdd, onRemove, onMove }: { pages: PageMeta[]; selected?: string; onOpen: (id: string) => void; onAdd: (parent?: string) => void; onRemove: (p: PageMeta) => void; onMove: (dragId: string, target: PageMeta, zone: 'before' | 'inside' | 'after') => void }) {
  const { t, canEdit } = useApp()
  const [over, setOver] = useState<{ id: string; zone: 'before' | 'inside' | 'after' } | null>(null)
  const qc = useQueryClient()
  const render = (parent: string | null, depth: number): React.ReactNode =>
    pages.filter((p) => (p.parentPageId ?? null) === parent).map((p) => (
      <div key={p.id}>
        <div
          draggable={canEdit}
          onDragStart={(e) => e.dataTransfer.setData('text/page', p.id)}
          onDragOver={(e) => {
            e.preventDefault()
            const r = e.currentTarget.getBoundingClientRect()
            const f = (e.clientY - r.top) / r.height
            setOver({ id: p.id, zone: f < 0.3 ? 'before' : f > 0.7 ? 'after' : 'inside' })
          }}
          onDragLeave={() => setOver(null)}
          onDrop={(e) => { e.preventDefault(); setOver(null); onMove(e.dataTransfer.getData('text/page'), p, over?.zone ?? 'inside') }}
          className={cn('group flex items-center gap-1 rounded-md pr-1 h-7 cursor-pointer text-[13.5px]', selected === p.id ? 'bg-accent font-medium' : 'hover:bg-muted', over?.id === p.id && over.zone === 'inside' && 'ring-1 ring-ring', over?.id === p.id && over.zone === 'before' && 'shadow-[0_-2px_0_var(--accent)]', over?.id === p.id && over.zone === 'after' && 'shadow-[0_2px_0_var(--accent)]')}
          style={{ paddingLeft: 6 + depth * 16 }}
          onClick={() => onOpen(p.id)}
        >
          <Popover>
            <PopoverTrigger asChild disabled={!canEdit}><button className="w-5 text-center" onClick={(e) => e.stopPropagation()}>{p.icon || '📄'}</button></PopoverTrigger>
            <PopoverContent className="w-auto p-1.5 grid grid-cols-6 gap-0.5">
              {ICONS.map((i) => (
                <button key={i} className="w-7 h-7 rounded hover:bg-muted" onClick={async (e) => {
                  e.stopPropagation()
                  await api(`pages/${p.id}`, { method: 'PATCH', json: { icon: i } })
                  qc.invalidateQueries({ queryKey: ['pages', p.personId] })
                }}>{i}</button>
              ))}
            </PopoverContent>
          </Popover>
          <span className="truncate flex-1">{p.title || <span className="text-ink-faint">{t('Без названия')}</span>}</span>
          {canEdit && (
            <span className="flex gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity">
              <button title={t('Подстраница')} className="p-0.5 rounded hover:bg-background text-ink-faint hover:text-ink" onClick={(e) => { e.stopPropagation(); onAdd(p.id) }}><Plus size={13} /></button>
              <button title={t('Удалить')} className="p-0.5 rounded hover:bg-background text-ink-faint hover:text-destructive" onClick={(e) => { e.stopPropagation(); onRemove(p) }}><Trash2 size={13} /></button>
            </span>
          )}
        </div>
        {render(p.id, depth + 1)}
      </div>
    ))
  return <div>{render(null, 0)}</div>
}

function FamilyTab({ person }: { person: Person }) {
  const app = useApp()
  const { t, family, byId, graph, canEdit, quickAdd, focus, lang } = app
  const remove = useWrite(({ type, id }: { type: string; id: string }) => api(`relations/${type}/${id}`, { method: 'DELETE' }))
  const setCertainty = useWrite(({ type, id, certainty, kind }: { type: string; id: string; certainty?: string; kind?: string }) => api(`relations/${type}/${id}`, { method: 'PATCH', json: { certainty, kind } }))
  const parents = graph.parentChild.filter((l) => l.childId === person.id)
  const children = graph.parentChild.filter((l) => l.parentId === person.id)
  const unions = graph.unions.filter((u) => u.aId === person.id || u.bId === person.id)
  const siblings = [...new Set((family.parents.get(person.id) ?? []).flatMap((p) => family.children.get(p) ?? []))].filter((s) => s !== person.id)

  const chip = (id: string, onRemove?: () => void, extra?: React.ReactNode) => {
    const p = byId.get(id)
    if (!p) return null
    return (
      <div key={id} className="group flex items-center gap-1.5 rounded-full bg-muted pl-1 pr-2 h-7 max-w-full max-sm:flex-wrap max-sm:h-auto max-sm:rounded-2xl max-sm:py-1">
        <button className="flex items-center gap-1.5 min-w-0" onClick={() => focus(id, { center: true })}>
          <Mini person={p} size={22} />
          <span className="truncate">{p.hidden ? t('Живой родственник') : personName(p) || t('Без названия')}</span>
          <span className="text-[11px] text-ink-faint whitespace-nowrap">{family.relation(person.id, id, lang)?.label}</span>
        </button>
        {extra}
        {canEdit && onRemove && <button className="max-sm:p-2 max-sm:-m-1 max-sm:ml-auto text-ink-faint hover:text-destructive opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity" title={t('Удалить связь')} onClick={onRemove}><X size={12} /></button>}
      </div>
    )
  }
  const kindToggle = (l: { id: string; kind: string; certainty: string }) => canEdit && (
    <select title={t('Уверенность')} value={`${l.kind}:${l.certainty}`} className="pick bg-transparent text-[11px] max-sm:text-[13px] text-ink-soft min-w-0 max-w-[130px] max-sm:max-w-full max-sm:basis-full max-sm:order-last truncate rounded hover:bg-background" onChange={(e) => {
      const [kind, certainty] = e.target.value.split(':')
      setCertainty.mutate({ type: 'parent', id: l.id, kind, certainty })
    }}>
      {(['birth', 'adopted', 'step'] as const).flatMap((k) => (Object.keys(CERTAINTY) as Certainty[]).map((c) => (
        <option key={`${k}:${c}`} value={`${k}:${c}`}>{t(k === 'birth' ? 'родной' : k === 'adopted' ? 'приёмный' : 'отчим или мачеха')} · {t(CERTAINTY[c])}</option>
      )))}
    </select>
  )
  const group = (title: string, items: React.ReactNode, add?: [string, string]) => (
    <section className="mb-4">
      <h4 className="text-xs text-ink-soft mb-1.5">{t(title)}</h4>
      <div className="flex flex-wrap gap-1.5 items-center">
        {items}
        {canEdit && add && (
          <button className="h-8 px-3 rounded-full border border-dashed border-ink-faint text-ink-soft hover:text-ink hover:border-ink flex items-center gap-1" onClick={() => quickAdd(add[0] as never, person.id)}><Plus size={14} /> {t(add[1])}</button>
        )}
      </div>
    </section>
  )
  return (
    <div className="px-6 py-4 text-[13px]">
      <datalist id="known-places">{[...new Set(graph.persons.flatMap((p) => [p.birthPlace, p.deathPlace]).concat(graph.unions.map((u) => u.place)).filter(Boolean))].sort().slice(0, 300).map((p) => <option key={p} value={p} />)}</datalist>
      {group('Родители', parents.map((l) => chip(l.parentId, () => remove.mutate({ type: 'parent', id: l.id }), kindToggle(l))), parents.length < 2 ? ['parent', 'Родитель'] : undefined)}
      {group('Супруги', unions.map((u) => (
        <div key={u.id} className="w-full flex flex-col gap-1.5 items-start">
          {chip(u.aId === person.id ? u.bId : u.aId, () => remove.mutate({ type: 'union', id: u.id }))}
          <UnionDetails union={u} />
        </div>
      )), ['spouse', 'Супруг'])}
      {group('Дети', children.map((l) => chip(l.childId, () => remove.mutate({ type: 'parent', id: l.id }), kindToggle(l))), ['child', 'Ребёнок'])}
      {siblings.length > 0 && group('Братья и сёстры', siblings.map((s) => chip(s)))}
    </div>
  )
}

function PhotosTab({ person }: { person: Person }) {
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
    <div className="px-6 py-4">
      {canEdit && (
        <>
          <button className="bar-btn border border-border mb-3" disabled={upload.isPending} onClick={() => input.current?.click()}>{t('Загрузить фото')}</button>
          <input ref={input} type="file" accept="image/*" multiple hidden onChange={async (e) => {
            const last = await upload.mutateAsync([...(e.target.files ?? [])])
            e.target.value = ''
            if (last) openPhoto(last.id)
          }} />
        </>
      )}
      {!images.length && <p className="text-ink-faint text-[13px]">{t('Добавьте первое фото: снимки помогают узнать человека')}</p>}
      <div className="grid grid-cols-3 gap-2">
        {images.map((m) => (
          <button key={m.id} className="aspect-square rounded-md overflow-hidden bg-muted hover:opacity-90 transition" onClick={() => openPhoto(m.id, images.map((i) => i.id))}>
            <img src={mediaUrl(m.id, 'thumb')} alt={m.caption} className="w-full h-full object-cover" loading="lazy" />
          </button>
        ))}
      </div>
    </div>
  )
}

/** Adds a label on Enter; suggests existing ones so the same group is reused, not retyped. */
function TagInput({ existing, onAdd }: { existing: string[]; onAdd: (tag: string) => void }) {
  const { t, graph } = useApp()
  const [v, setV] = useState('')
  const known = useMemo(() => [...new Set(graph.persons.flatMap((p) => p.tags))].filter((x) => !existing.includes(x)), [graph, existing])
  const hint = known.filter((x) => v.trim() && x.toLowerCase().startsWith(v.trim().toLowerCase())).slice(0, 3)
  const add = (tag: string) => {
    const clean = tag.trim()
    if (clean && !existing.includes(clean)) onAdd(clean)
    setV('')
  }
  return (
    <span className="relative">
      <input
        value={v}
        placeholder={t('Группа или метка')}
        aria-label={t('Группа или метка')}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(hint[0] ?? v) } }}
        onBlur={() => v.trim() && add(v)}
        className="h-6 w-40 rounded-full border border-dashed border-ink-faint bg-transparent px-2.5 text-xs outline-none focus:border-ink focus:border-solid"
      />
      {hint.length > 0 && (
        <span className="absolute left-0 top-7 z-10 flex flex-col rounded-lg border border-border bg-white shadow-sm text-xs overflow-hidden">
          {hint.map((h) => <button key={h} type="button" className="px-2.5 py-1 text-left hover:bg-muted" onMouseDown={(e) => { e.preventDefault(); add(h) }}>{h}</button>)}
        </span>
      )}
    </span>
  )
}

/** One dated fact: what happened, when, where, a note and where it is known from. Saved when the field loses focus. */
function FactRow({ fact, readOnly, fresh, onChange, onRemove }: { fact: Fact; readOnly: boolean; fresh: boolean; onChange: (f: Fact) => void; onRemove: () => void }) {
  const { t } = useApp()
  const [f, setF] = useState(fact)
  useEffect(() => setF(fact), [fact])
  const commit = () => { if (JSON.stringify(f) !== JSON.stringify(fact)) onChange(f) }
  const field = (key: keyof Fact, placeholder: string, cls: string, list?: string, auto?: boolean) => (
    <input value={f[key] ?? ''} readOnly={readOnly} autoFocus={auto} list={list} placeholder={readOnly ? '' : t(placeholder)} aria-label={t(placeholder)} onChange={(e) => setF({ ...f, [key]: e.target.value })} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} className={cn('inline-input min-w-0', cls)} />
  )
  const row = (label: string, key: keyof Fact, placeholder: string, list?: string, auto?: boolean) => (!readOnly || f[key]) && (
    <>
      <span className="text-xs text-ink-faint">{t(label)}</span>
      {field(key, placeholder, 'text-ink', list, auto)}
    </>
  )
  return (
    <div className="group relative rounded-md border border-border px-2.5 py-1.5 flex flex-col gap-1">
      <div className="pr-5">{field('kind', 'Что произошло', 'font-medium', 'fact-kinds', fresh && !fact.kind)}</div>
      <div className="grid grid-cols-[64px_1fr] gap-x-2 gap-y-0.5 items-baseline">
        {row('Когда', 'date', 'напр. 1912', undefined, fresh && !!fact.kind)}
        {row('Где', 'place', 'напр. Пермь', 'known-places')}
        {row('Заметка', 'note', 'подробности')}
        {row('Источник', 'source', 'документ, архив, чей рассказ')}
      </div>
      {!readOnly && <button aria-label={t('Удалить')} title={t('Удалить')} className="absolute right-1.5 top-1.5 p-0.5 max-sm:p-2 max-sm:right-0 max-sm:top-0 opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100 text-ink-faint hover:text-destructive" onClick={onRemove}><X size={13} /></button>}
    </div>
  )
}

const CERTAINTY_HINT: Record<Certainty, string> = {
  documented: 'есть запись или документ',
  family: 'со слов родных, без документа',
  assumed: 'пока не подтверждено, нужно проверить',
}

/** Common kinds of fact, one click each, so the same wording is reused and GEDCOM gets its tags. */
const FACT_KINDS = ['Профессия', 'Место жительства', 'Образование', 'Служба', 'Награда', 'Переезд', 'Крещение', 'Погребение', 'Причина смерти', 'Вероисповедание', 'Национальность']

const QUALIFIERS: [string, string][] = [['', 'точно'], ['~', 'около'], ['<', 'до'], ['>', 'после']]

/** A date with how sure it is: stored as the "~1890", "<1890", ">1890" that GEDCOM export understands. */
function DateField({ value, onSave, readOnly, placeholder, id }: { value: string; onSave: (v: string) => void; readOnly: boolean; placeholder: string; id?: string }) {
  const { t } = useApp()
  const m = value.match(/^([~<>])\s*(.*)$/)
  const q = m?.[1] ?? ''
  const rest = m ? m[2] : value
  return (
    <div className="flex items-baseline gap-1 min-w-0">
      {rest && (readOnly
        ? q && <span className="text-ink-soft">{t(QUALIFIERS.find(([k]) => k === q)![1])}</span>
        : <select aria-label={t('Точность даты')} value={q} onChange={(e) => onSave(e.target.value + rest)} className="flex-none bg-transparent text-ink-soft text-[12px] rounded hover:bg-muted max-sm:min-h-8">{QUALIFIERS.map(([k, label]) => <option key={k} value={k}>{t(label)}</option>)}</select>)}
      <Field id={id} readOnly={readOnly} value={rest} placeholder={placeholder} onSave={(v) => onSave(v.trim() ? (/^[~<>]/.test(v) ? v : q + v) : '')} />
    </div>
  )
}

function Details({ person, patch, go, photoCount, pageCount }: { person: Person; patch: (p: Partial<Person>) => void; go: (tab: string, fieldId?: string) => void; photoCount: number; pageCount: number }) {
  const { t, canEdit, graph, lang } = useApp()
  const ro = !canEdit
  const save = (key: keyof Person) => (v: string) => patch({ [key]: v })
  const [fresh, setFresh] = useState(-1)
  const places = useMemo(() => [...new Set(graph.persons.flatMap((p) => [p.birthPlace, p.deathPlace, ...p.facts.map((f) => f.place)]).concat(graph.unions.map((u) => u.place)).filter(Boolean))].sort().slice(0, 300), [graph])
  const hasParents = graph.parentChild.some((l) => l.childId === person.id)
  const alive = person.living
  const todo: [string, boolean, string, string?][] = [
    ['пол', person.sex !== 'U', 'details', 'f-sex'],
    ['дату рождения', !!person.birthDate, 'details', 'f-birth-date'],
    ['место рождения', !!person.birthPlace, 'details', 'f-birth-place'],
    ...(alive ? [] : [['дату смерти', !!person.deathDate, 'details', 'f-death-date'], ['место смерти', !!person.deathPlace, 'details', 'f-death-place']] as [string, boolean, string, string?][]),
    ['родителей', hasParents, 'family'],
    ['фото', photoCount > 0 || !!person.avatarMediaId, 'photos'],
    ['биографию', pageCount > 0, 'pages'],
  ]
  const done = todo.filter((x) => x[1]).length
  const now = new Date().getFullYear()
  const age = person.birthYear ? (alive ? now : person.deathYear) : null
  const years = person.birthYear && age ? age - person.birthYear : null
  const badOrder = !!(person.birthYear && person.deathYear && person.deathYear < person.birthYear)
  const tooOld = alive && !!person.birthYear && now - person.birthYear > 110
  const f = person.sex === 'F', u = person.sex === 'U'

  return (
    <div className="px-6 max-sm:px-4 pb-5 flex flex-col gap-4 text-[13px]">
      <datalist id="fact-kinds">{FACT_KINDS.map((k) => <option key={k} value={t(k)} />)}</datalist>
      <datalist id="known-places">{places.map((p) => <option key={p} value={p} />)}</datalist>

      {canEdit && done < todo.length && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 text-xs text-ink-soft">
            <span className="whitespace-nowrap">{t('Заполнено')} {done} {t('из')} {todo.length}</span>
            <span className="h-1 flex-1 rounded-full bg-muted overflow-hidden"><span className="block h-full bg-rust" style={{ width: `${(done / todo.length) * 100}%` }} /></span>
          </div>
          <div className="flex flex-wrap gap-1 items-center text-xs">
            <span className="text-ink-faint">{t('Добавьте')}:</span>
            {todo.filter((x) => !x[1]).map(([label, , tab, field]) => <button key={label} className="pick rounded-full bg-muted px-2 h-6 text-ink-soft hover:text-ink" onClick={() => go(tab, field)}>{t(label)}</button>)}
          </div>
        </div>
      )}

      <dl className="grid grid-cols-[92px_1fr_1fr] max-sm:grid-cols-[72px_1fr_1fr] gap-x-3 max-sm:gap-x-2 gap-y-2 items-center">
        <dt className="text-ink-soft max-sm:col-span-3 max-sm:-mb-1">{t('Пол')}</dt>
        <dd className="col-span-2 max-sm:col-span-3"><Segmented id="f-sex" label={t('Пол')} disabled={ro} value={person.sex} onChange={(sex) => patch({ sex })} options={[['M', t('Мужской')], ['F', t('Женский')], ['U', t('Неизвестно')]]} /></dd>

        <dt className="text-ink-soft max-sm:col-span-3 max-sm:-mb-1">{t('Статус')}</dt>
        <dd className="col-span-2 max-sm:col-span-3 flex flex-wrap items-center gap-2">
          <Segmented label={t('Статус')} disabled={ro} value={alive ? 'alive' : 'dead'} onChange={(v) => { patch({ living: v === 'alive' }); if (v === 'dead') setTimeout(() => document.getElementById('f-death-date')?.focus(), 80) }} options={[['alive', t(u ? 'Жив(а)' : f ? 'Жива' : 'Жив')], ['dead', t(u ? 'Умер(ла)' : f ? 'Умерла' : 'Умер')]]} />
          {years !== null && years >= 0 && <span className="text-ink-soft">{alive ? ageWords(years, lang) : `${t('прожито')}: ${ageWords(years, lang)}`}</span>}
        </dd>

        <span />
        <span className="text-[11px] uppercase tracking-wide text-ink-faint">{t('Дата')}</span>
        <span className="text-[11px] uppercase tracking-wide text-ink-faint">{t('Место')}</span>

        <dt className="text-ink-soft">{t('Рождение')}</dt>
        <DateField id="f-birth-date" readOnly={ro} value={person.birthDate} placeholder={t('напр. 1890')} onSave={save('birthDate')} />
        <Field id="f-birth-place" list="known-places" readOnly={ro} value={person.birthPlace} placeholder={t('напр. Пермь')} onSave={save('birthPlace')} />

        {!alive && (
          <>
            <dt className="text-ink-soft">{t('Смерть')}</dt>
            <DateField id="f-death-date" readOnly={ro} value={person.deathDate} placeholder={t('напр. 1950')} onSave={save('deathDate')} />
            <Field id="f-death-place" list="known-places" readOnly={ro} value={person.deathPlace} placeholder={t('напр. Пермь')} onSave={save('deathPlace')} />
          </>
        )}

        {(person.otherNames || !ro) && (
          <>
            <dt className="text-ink-soft max-sm:col-span-3 max-sm:-mb-1">{t('Другие имена')}</dt>
            <dd className="col-span-2 max-sm:col-span-3"><Field readOnly={ro} value={person.otherNames} placeholder={t('прозвище, имя в крещении')} onSave={save('otherNames')} /></dd>
          </>
        )}

        <dt className="text-ink-soft self-start pt-1 max-sm:col-span-3 max-sm:-mb-1">{t('Уверенность')}</dt>
        <dd className="col-span-2 max-sm:col-span-3">
          <Segmented label={t('Уверенность')} disabled={ro} value={person.certainty} onChange={(certainty) => patch({ certainty })} options={(Object.keys(CERTAINTY) as Certainty[]).map((c) => [c, t(CERTAINTY[c])] as [Certainty, string])} />
          <p className="mt-1 text-[12px] text-ink-soft">{t(CERTAINTY_HINT[person.certainty])}</p>
        </dd>
      </dl>

      {badOrder && <p role="alert" className="text-xs text-destructive">{t('Дата смерти раньше даты рождения: проверьте годы')}</p>}
      {tooOld && canEdit && <p className="text-xs text-ink-soft">{t('Больше 110 лет.')} <button className="underline hover:text-ink" onClick={() => patch({ living: false })}>{t('Отметить как умершего')}</button></p>}

      {(person.facts.length > 0 || !ro) && (
        <section className="flex flex-col gap-1.5">
          <h4 className="text-xs text-ink-soft">{t('Факты')}</h4>
          {person.facts.map((fact, i) => (
            <FactRow
              key={i}
              fact={fact}
              readOnly={ro}
              fresh={fresh === i}
              onChange={(next) => patch({ facts: person.facts.map((x, j) => (j === i ? next : x)) })}
              onRemove={() => patch({ facts: person.facts.filter((_, j) => j !== i) })}
            />
          ))}
          {!ro && (
            <div className="flex flex-wrap gap-1">
              {[...FACT_KINDS, ''].map((k) => (
                <button key={k} className="pick rounded-full border border-dashed border-ink-faint px-2 h-6 text-xs text-ink-soft hover:text-ink hover:border-ink" onClick={() => { setFresh(person.facts.length); patch({ facts: [...person.facts, { kind: k && t(k), date: '', place: '', note: '', source: '' }] }) }}>+ {t(k || 'Другое')}</button>
              ))}
            </div>
          )}
        </section>
      )}

      {(person.tags.length > 0 || !ro) && (
        <section className="flex flex-col gap-1.5">
          <h4 className="text-xs text-ink-soft">{t('Группы')}</h4>
          <div className="flex flex-wrap gap-1.5 items-center">
            {person.tags.map((tag) => (
              <span key={tag} className="flex items-center gap-1 rounded-full bg-muted pl-2.5 pr-1.5 h-6 text-xs">
                {tag}
                {!ro && <button aria-label={t('Удалить')} className="text-ink-faint hover:text-destructive" onClick={() => patch({ tags: person.tags.filter((x) => x !== tag) })}><X size={11} /></button>}
              </span>
            ))}
            {!ro && <TagInput existing={person.tags} onAdd={(tag) => patch({ tags: [...person.tags, tag] })} />}
          </div>
        </section>
      )}
    </div>
  )
}

/** The marriage itself: which kind, when it began and ended, where. */
function UnionDetails({ union: u }: { union: Union }) {
  const { t, canEdit } = useApp()
  const edit = useWrite((json: Partial<Union>) => api(`relations/union/${u.id}`, { method: 'PATCH', json }))
  const ro = !canEdit
  // "?" keeps an ended union whose date nobody knows.
  const ended = !!u.endDate
  if (ro && !u.startDate && !u.endDate && !u.place) return null
  return (
    <div className="pl-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 items-center justify-items-start w-full">
      <span className="text-ink-soft">{t('Союз')}</span>
      <Segmented label={t('Союз')} disabled={ro} value={u.kind} onChange={(kind) => edit.mutate({ kind })} options={[['marriage', t('Брак')], ['civil', t('Без регистрации')]]} />
      <span className="text-ink-soft">{t('Начало')}</span>
      <DateField readOnly={ro} value={u.startDate} placeholder={t('напр. 1945')} onSave={(startDate) => edit.mutate({ startDate })} />
      <span className="text-ink-soft">{t('Место')}</span>
      <Field list="known-places" className="!w-full" readOnly={ro} value={u.place} placeholder={t('напр. Пермь')} onSave={(place) => edit.mutate({ place })} />
      {!ro && (
        <label className="col-span-2 flex items-center gap-2 cursor-pointer min-h-7">
          <input type="checkbox" className="accent-[var(--ink)] size-4" checked={ended} onChange={(e) => edit.mutate({ endDate: e.target.checked ? '?' : '' })} />
          {t('Союз распался')}
        </label>
      )}
      {ended && (
        <>
          <span className="text-ink-soft">{t('Конец')}</span>
          <DateField readOnly={ro} value={u.endDate === '?' ? '' : u.endDate} placeholder={ro ? t('дата неизвестна') : t('напр. 1960')} onSave={(endDate) => edit.mutate({ endDate: endDate || '?' })} />
        </>
      )}
    </div>
  )
}

/** A row of choices shown at once: one click picks, nothing hides behind a drop-down. */
function Segmented<T extends string>({ value, options, disabled, onChange, label, id }: { value: T; options: [T, string][]; disabled?: boolean; onChange: (v: T) => void; label: string; id?: string }) {
  // Someone who cannot change it needs the value, not a row of dead buttons.
  if (disabled) return <span>{options.find(([v]) => v === value)?.[1]}</span>
  return (
    <div id={id} tabIndex={id ? -1 : undefined} role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-lg bg-muted p-0.5 gap-0.5">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          disabled={disabled}
          onClick={() => onChange(v)}
          className={cn('h-7 px-2.5 rounded-md text-[13px] transition-colors disabled:cursor-default', value === v ? 'bg-white text-ink shadow-sm font-medium' : 'text-ink-soft hover:text-ink')}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
