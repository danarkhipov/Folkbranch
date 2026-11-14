'use client'
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { ExternalLink, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { api, useApp } from '@/lib/client'
import { findPlace, mapSpots, placeChain, placesInUse, PLACE_KINDS } from '@/lib/places'
import { personName, type Place, type PlaceName, type Repository } from '@/lib/types'
import { Segmented } from './person-fields'

export const usePlaces = () => useQuery({ queryKey: ['places'], queryFn: () => api<Place[]>('places') })
export const useRepositories = () => useQuery({ queryKey: ['repositories'], queryFn: () => api<Repository[]>('repositories') })

/** The map and its library load only when someone opens it. */
const PlaceMap = dynamic(() => import('./place-map').then((m) => m.PlaceMap), { ssr: false })

/** Coordinates also open in a map the person chooses, outside the archive. */
const mapLink = (p: { lat: number | null; lon: number | null }) => (p.lat !== null && p.lon !== null ? `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=12/${p.lat}/${p.lon}` : '')

type Draft = Omit<Place, 'id'> & { id: string | null }

function PlaceForm({ draft, places, onDone }: { draft: Draft; places: Place[]; onDone: () => void }) {
  const { t, notify } = useApp()
  const qc = useQueryClient()
  const [d, setD] = useState(draft)
  const [lat, setLat] = useState(d.lat === null ? '' : String(d.lat))
  const [lon, setLon] = useState(d.lon === null ? '' : String(d.lon))
  const [busy, setBusy] = useState(false)
  // Nothing inside this place can become what it belongs to.
  const inside = useMemo(() => new Set(d.id ? places.filter((p) => placeChain(p, places).some((x) => x.id === d.id)).map((p) => p.id) : []), [d.id, places])
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))
  const save = async () => {
    setBusy(true)
    try {
      const body = { name: d.name, kind: d.kind, parentId: d.parentId, otherNames: d.otherNames.filter((n) => n.name.trim()), lat: num(lat), lon: num(lon), note: d.note }
      await api(d.id ? `places/${d.id}` : 'places', { method: d.id ? 'PUT' : 'POST', json: body })
      await qc.invalidateQueries({ queryKey: ['places'] })
      onDone()
    } catch (e) {
      notify(`${t('Не сохранилось')}: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }
  const setName = (i: number, patch: Partial<PlaceName>) => setD({ ...d, otherNames: d.otherNames.map((n, j) => (j === i ? { ...n, ...patch } : n)) })
  const badCoords = [lat, lon].some((s) => s.trim() && !Number.isFinite(num(s)))
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-white p-3">
      <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Название')}<Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></label>
      <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
        <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Что это')}<Select value={d.kind} onChange={(kind) => setD({ ...d, kind })} options={[{ value: '', label: t('Не указано') }, ...PLACE_KINDS.map((k) => ({ value: k, label: t(k) }))]} /></label>
        <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Входит в')}<Select value={d.parentId ?? ''} onChange={(v) => setD({ ...d, parentId: v || null })} options={[{ value: '', label: t('Никуда') }, ...places.filter((p) => !inside.has(p.id) && p.id !== d.id).map((p) => ({ value: p.id, label: p.kind ? `${p.name} (${t(p.kind).toLowerCase()})` : p.name }))]} /></label>
      </div>
      <div className="flex flex-col gap-1 text-xs text-ink-soft">
        {t('Другие и старые названия')}
        {d.otherNames.map((n, i) => (
          <div key={i} className="flex gap-1.5">
            <Input aria-label={t('Название')} value={n.name} placeholder={t('Например, Калинин')} onChange={(e) => setName(i, { name: e.target.value })} />
            <Input aria-label={t('Годы')} className="w-32 flex-none" value={n.years} placeholder={t('1931–1990')} onChange={(e) => setName(i, { years: e.target.value })} />
            <button type="button" aria-label={t('Убрать')} title={t('Убрать')} className="grid size-9 flex-none place-items-center text-ink-faint hover:text-destructive" onClick={() => setD({ ...d, otherNames: d.otherNames.filter((_, j) => j !== i) })}><X size={14} /></button>
          </div>
        ))}
        <button type="button" className="self-start underline underline-offset-2 hover:text-ink" onClick={() => setD({ ...d, otherNames: [...d.otherNames, { name: '', years: '' }] })}>+ {t('название')}</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Широта')}<Input inputMode="decimal" value={lat} placeholder="56.86" onChange={(e) => setLat(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Долгота')}<Input inputMode="decimal" value={lon} placeholder="35.90" onChange={(e) => setLon(e.target.value)} /></label>
      </div>
      {badCoords && <p role="alert" className="text-xs text-destructive">{t('Координаты пишутся числом, например 56.86')}</p>}
      <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Заметка')}<Textarea rows={2} value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} /></label>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || !d.name.trim() || badCoords} onClick={save}>{t('Сохранить')}</Button>
        <Button size="sm" variant="outline" onClick={onDone}>{t('Отмена')}</Button>
      </div>
    </div>
  )
}

/** Every place the archive mentions, as written, and what is known of each: what it belonged to and its other names. */
export function PlacesTab({ onOpen }: { onOpen: (id: string) => void }) {
  const { t, view: graph, byId, canEdit, confirm } = useApp()
  const qc = useQueryClient()
  const { data: places = [] } = usePlaces()
  const [editing, setEditing] = useState<Draft | null>(null)
  // Which row the form opened under: a place, or a place as written that has no record yet.
  const [at, setAt] = useState('')
  const [filter, setFilter] = useState('')
  const [view, setView] = useState<'list' | 'map'>('list')
  const uses = useMemo(() => placesInUse(graph), [graph])
  const marks = useMemo(() => mapSpots(graph, places).map((s) => ({
    id: s.place.id, lat: s.place.lat, lon: s.place.lon, title: s.place.name,
    note: [placeChain(s.place, places).slice(1).map((x) => x.name).join(' → '), s.place.otherNames.map((n) => n.name).join(', ')].filter(Boolean).join(' · '),
    people: s.people.flatMap((id) => { const p = byId.get(id); return p && !p.hidden ? [{ id, name: personName(p) }] : [] }),
  })), [graph, places, byId])
  // Written places grouped by the record they mean; a record with no mention still shows.
  const rows = useMemo(() => {
    const byPlace = new Map<string, { place: Place | null; texts: string[]; people: Set<string> }>()
    for (const u of uses) {
      const place = findPlace(u.text, places)
      const k = place?.id ?? `text:${u.text.toLowerCase()}`
      const row = byPlace.get(k) ?? { place, texts: [], people: new Set<string>() }
      row.texts.push(u.text)
      u.people.forEach((id) => row.people.add(id))
      byPlace.set(k, row)
    }
    for (const p of places) if (!byPlace.has(p.id)) byPlace.set(p.id, { place: p, texts: [], people: new Set() })
    const q = filter.trim().toLowerCase()
    return [...byPlace.values()].filter((r) => !q || [...r.texts, r.place?.name ?? '', ...(r.place?.otherNames.map((n) => n.name) ?? [])].some((x) => x.toLowerCase().includes(q)))
      .sort((a, b) => b.people.size - a.people.size)
  }, [uses, places, filter])
  const blank = (name: string): Draft => ({ id: null, name: name.split(',')[0].trim(), kind: '', parentId: null, otherNames: [], lat: null, lon: null, note: '' })
  const remove = async (p: Place) => {
    if (!(await confirm(t('Удалить сведения о месте «{name}»?').replace('{name}', () => p.name), t('Удалить'), t('Карточки людей не изменятся. Вернуть можно в истории.')))) return
    await api(`places/${p.id}`, { method: 'DELETE' })
    qc.invalidateQueries({ queryKey: ['places'] })
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-ink-soft">{t('Места из карточек. Укажите, во что место входило, и его старые названия: тогда поиск найдёт людей и по прежнему имени.')}</p>
      <Segmented label={t('Как показать')} value={view} onChange={setView} options={[['list', t('Списком')], ['map', t('На карте')]]} />
      {view === 'map' && (marks.length
        ? <PlaceMap marks={marks} onPerson={onOpen} className="h-80" />
        : <p className="text-ink-soft">{t('На карте пока пусто: ни у одного места нет широты и долготы. Их можно добавить в сведениях о месте.')}</p>)}
      {view === 'list' && <>
      <div className="flex gap-2">
        <Input aria-label={t('Найти место')} placeholder={t('Найти место')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        {canEdit && <Button size="sm" variant="outline" className="flex-none" onClick={() => { setAt('new'); setEditing(blank('')) }}><Plus /> {t('Место')}</Button>}
      </div>
      {editing && at === 'new' && <PlaceForm draft={editing} places={places} onDone={() => setEditing(null)} />}
      {!rows.length && <p className="text-ink-faint">{t('Мест пока нет.')}</p>}
      <ul className="flex flex-col">
        {rows.map((r, i) => {
          const place = r.place
          const chain = place ? placeChain(place, places) : []
          const link = place ? mapLink(place) : ''
          const rowKey = place?.id ?? `text:${r.texts[0]}`
          const isEditing = !!editing && at === rowKey
          return (
            <li key={place?.id ?? r.texts[0] + i} className="flex flex-col gap-1 border-b border-border py-2 last:border-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-medium break-anywhere">{place ? place.name : r.texts[0]}</span>
                {place?.kind && <span className="text-xs text-ink-soft">{t(place.kind).toLowerCase()}</span>}
                {chain.length > 1 && <span className="text-xs text-ink-soft break-anywhere">{chain.slice(1).map((x) => x.name).join(' → ')}</span>}
                {link && <a className="inline-flex items-center gap-0.5 text-xs text-ink-soft underline" href={link} target="_blank" rel="noreferrer noopener">{t('на карте')} <ExternalLink size={11} /></a>}
                <span className="ml-auto text-xs text-ink-faint">{t('Людей')}: {r.people.size}</span>
              </div>
              {place && place.otherNames.length > 0 && <span className="text-xs text-ink-soft break-anywhere">{t('Также')}: {place.otherNames.map((n) => (n.years ? `${n.name} (${n.years})` : n.name)).join(', ')}</span>}
              {r.texts.length > 1 && <span className="text-xs text-ink-faint break-anywhere">{t('Записано как')}: {r.texts.join('; ')}</span>}
              {r.people.size > 0 && (
                <span className="flex flex-wrap gap-x-2 text-xs">
                  {[...r.people].slice(0, 8).map((id) => <button key={id} className="pick underline-offset-2 hover:underline" onClick={() => onOpen(id)}>{byId.get(id) ? personName(byId.get(id)!) : ''}</button>)}
                  {r.people.size > 8 && <span className="text-ink-faint">+{r.people.size - 8}</span>}
                </span>
              )}
              {canEdit && !isEditing && (
                <span className="flex gap-3 text-xs text-ink-soft">
                  <button className="underline underline-offset-2 hover:text-ink" onClick={() => { setAt(rowKey); setEditing(place ? { ...place } : blank(r.texts[0])) }}>{t(place ? 'Изменить' : 'Добавить сведения')}</button>
                  {place && <button className="flex items-center gap-1 hover:text-destructive" onClick={() => remove(place)}><Trash2 size={11} /> {t('Удалить')}</button>}
                </span>
              )}
              {isEditing && editing && <PlaceForm draft={editing} places={places} onDone={() => setEditing(null)} />}
            </li>
          )
        })}
      </ul>
      </>}
    </div>
  )
}

/** Where sources are kept: the archive's address and site, and how many sources point to each. */
export function ArchivesTab() {
  const { t, view: graph, canEdit, confirm, notify } = useApp()
  const qc = useQueryClient()
  const { data: list = [] } = useRepositories()
  const [editing, setEditing] = useState<(Omit<Repository, 'id'> & { id: string | null }) | null>(null)
  const uses = useMemo(() => {
    const n = new Map<string, number>()
    for (const p of graph.persons) for (const s of p.sources) if (s.repositoryId) n.set(s.repositoryId, (n.get(s.repositoryId) ?? 0) + 1)
    return n
  }, [graph])
  const save = async () => {
    if (!editing) return
    try {
      const { id, ...body } = editing
      await api(id ? `repositories/${id}` : 'repositories', { method: id ? 'PUT' : 'POST', json: body })
      await qc.invalidateQueries({ queryKey: ['repositories'] })
      setEditing(null)
    } catch (e) {
      notify(`${t('Не сохранилось')}: ${(e as Error).message}`)
    }
  }
  const remove = async (r: Repository) => {
    if (!(await confirm(t('Удалить архив «{name}»?').replace('{name}', () => r.name), t('Удалить'), t('Источники останутся, но без ссылки на архив. Вернуть можно в истории.')))) return
    await api(`repositories/${r.id}`, { method: 'DELETE' })
    qc.invalidateQueries({ queryKey: ['repositories'] })
  }
  const form = editing && (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-white p-3">
      <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Название')}<Input value={editing.name} placeholder={t('Например, Государственный архив Тверской области')} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
      <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Адрес')}<Input value={editing.address} onChange={(e) => setEditing({ ...editing, address: e.target.value })} /></label>
      <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Сайт')}<Input value={editing.url} placeholder="https://…" onChange={(e) => setEditing({ ...editing, url: e.target.value })} /></label>
      <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Заметка')}<Textarea rows={2} value={editing.note} placeholder={t('Например, как заказать копию')} onChange={(e) => setEditing({ ...editing, note: e.target.value })} /></label>
      <div className="flex gap-2"><Button size="sm" disabled={!editing.name.trim()} onClick={save}>{t('Сохранить')}</Button><Button size="sm" variant="outline" onClick={() => setEditing(null)}>{t('Отмена')}</Button></div>
    </div>
  )
  return (
    <div className="flex flex-col gap-2">
      <p className="text-ink-soft">{t('Где хранятся источники. Выберите архив у источника в карточке человека, и он появится здесь.')}</p>
      {canEdit && !editing && <Button size="sm" variant="outline" className="self-start" onClick={() => setEditing({ id: null, name: '', address: '', url: '', note: '' })}><Plus /> {t('Архив')}</Button>}
      {editing && !editing.id && form}
      {!list.length && !editing && <p className="text-ink-faint">{t('Архивов пока нет.')}</p>}
      <ul className="flex flex-col">
        {list.map((r) => (
          <li key={r.id} className="flex flex-col gap-0.5 border-b border-border py-2 last:border-0">
            <div className="flex flex-wrap items-baseline gap-2"><span className="font-medium break-anywhere">{r.name}</span><span className="ml-auto text-xs text-ink-faint">{t('Источников')}: {uses.get(r.id) ?? 0}</span></div>
            {r.address && <span className="text-xs text-ink-soft break-anywhere">{r.address}</span>}
            {/^https?:\/\//i.test(r.url) && <a className="inline-flex items-center gap-0.5 self-start text-xs text-ink-soft underline break-all" href={r.url} target="_blank" rel="noreferrer noopener">{r.url} <ExternalLink size={11} /></a>}
            {r.note && <span className="text-xs break-anywhere">{r.note}</span>}
            {canEdit && editing?.id !== r.id && <span className="flex gap-3 text-xs text-ink-soft"><button className="underline underline-offset-2 hover:text-ink" onClick={() => setEditing({ ...r })}>{t('Изменить')}</button><button className="flex items-center gap-1 hover:text-destructive" onClick={() => remove(r)}><Trash2 size={11} /> {t('Удалить')}</button></span>}
            {editing?.id === r.id && form}
          </li>
        ))}
      </ul>
    </div>
  )
}
