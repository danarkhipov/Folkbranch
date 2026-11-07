'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, RotateCcw, ScanFace, Square, UserRound, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api, mediaUrl, useApp } from '@/lib/client'
import { squareCrop } from '@/lib/faces'
import { readDevice } from '@/lib/smart/device'
import type { FaceSuggestion } from '@/lib/smart/face-id'
import { personName, type Box, type Media } from '@/lib/types'
import { Mini } from './person-pickers'

const PER_RUN = 20

/** Faces across all the photos: the app suggests who it is, a person says yes or no. Runs only when asked to. */
export function FaceReview() {
  const { t, byId, focus, notify } = useApp()
  const qc = useQueryClient()
  const { data: photos = [] } = useQuery({ queryKey: ['media'], queryFn: () => api<Media[]>('media') })
  const [found, setFound] = useState<FaceSuggestion[]>([])
  const [progress, setProgress] = useState<string | null>(null)
  const [left, setLeft] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const stop = useRef<AbortController | null>(null)
  useEffect(() => () => stop.current?.abort(), [])

  // People with a framed face and no portrait: nothing to recognise, one press away.
  const noPortrait = useMemo(() => {
    const first = new Map<string, { media: Media; box: Box }>()
    for (const m of photos) for (const tag of m.tags) {
      const p = tag.personId ? byId.get(tag.personId) : undefined
      if (p && !p.avatarMediaId && !p.hidden && tag.x !== null && !first.has(p.id)) first.set(p.id, { media: m, box: tag as Box })
    }
    return [...first]
  }, [photos, byId])

  const setPortrait = async (personId: string, mediaId: string, box: Box, width: number, height: number) => {
    await api(`persons/${personId}/avatar`, { method: 'PUT', json: { mediaId, crop: squareCrop(box, width, height) } })
    await qc.invalidateQueries({ queryKey: ['graph'] })
  }

  const scan = async () => {
    const run = (stop.current = new AbortController())
    setFailed(false)
    setProgress(t('Готовлю модель узнавания…'))
    try {
      const { learnFaces, scanPhotos } = await import('@/lib/smart/face-id')
      const tags = photos.flatMap((m) => m.tags.map((tag) => ({ tag, mediaId: m.id, url: mediaUrl(m.id) })))
      const known = (await learnFaces(tags, (p) => setProgress(p.stage === 'model' ? t('Готовлю модель узнавания…') : `${t('Сравниваю с отмеченными лицами')}: ${p.done} ${t('из')} ${p.total}`), run.signal)).filter((k) => byId.has(k.personId))
      if (!known.length) { setProgress(null); return notify(t('Сначала отметьте лица хотя бы на нескольких фото: приложению не с чем сравнивать.')) }
      const result = await scanPhotos(photos.map((m) => ({ id: m.id, url: mediaUrl(m.id), tags: m.tags })), known, {
        limit: PER_RUN,
        pause: readDevice().tier === 'weak' ? 400 : 60,
        signal: run.signal,
        onProgress: (done, total) => setProgress(`${t('Просматриваю фото')}: ${done} ${t('из')} ${total}`),
        onFound: (s) => setFound((all) => (all.some((x) => x.key === s.key) ? all : [...all, s])),
      })
      setLeft(result.left)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') { console.error(e); setFailed(true) }
    }
    setProgress(null)
  }

  const accept = async (s: FaceSuggestion, portrait: boolean) => {
    try {
      await api(`media/${s.mediaId}/tags`, { json: { personId: s.personId, box: s.box } })
      if (portrait) await setPortrait(s.personId, s.mediaId, s.box, s.width, s.height)
      await qc.invalidateQueries({ queryKey: ['media'] })
      setFound((all) => all.filter((x) => x.key !== s.key))
    } catch (e) {
      notify(`${t('Не удалось сохранить')}: ${(e as Error).message}`)
    }
  }
  const refuse = async (s: FaceSuggestion) => {
    setFound((all) => all.filter((x) => x.key !== s.key))
    const { refuseFace } = await import('@/lib/smart/face-id')
    await refuseFace(s)
  }
  const again = async () => {
    const { forgetScans } = await import('@/lib/smart/face-id')
    await forgetScans()
    setFound([])
    setLeft(null)
    scan()
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-auto px-3 pb-3 text-sm">
      <p className="text-xs text-ink-soft">{t('Приложение ищет на фото уже отмеченных людей. Всё работает в этом браузере, а имя появится только после вашего «Да».')}</p>
      {noPortrait.length > 0 && (
        <section className="flex flex-col gap-1">
          <h4 className="font-medium">{t('Можно поставить портрет')}</h4>
          {noPortrait.map(([id, { media, box }]) => {
            const p = byId.get(id)!
            return (
              <div key={id} className="flex items-center gap-2 py-1">
                <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => focus(id, { center: true })}><Mini person={p} /> <span className="truncate">{personName(p)}</span></button>
                <Button variant="outline" size="sm" onClick={() => setPortrait(id, media.id, box, media.width, media.height)}><UserRound /> {t('Поставить')}</Button>
              </div>
            )
          })}
        </section>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {progress
          ? <><span role="status" className="text-xs text-ink-soft">{progress}</span><Button variant="outline" size="sm" onClick={() => stop.current?.abort()}><Square /> {t('Остановить')}</Button></>
          : <Button variant="outline" onClick={scan}><ScanFace /> {t(left ? 'Просмотреть ещё' : 'Найти знакомых на фото')}</Button>}
        {!progress && left !== null && <Button variant="ghost" size="sm" onClick={again}><RotateCcw /> {t('Просмотреть всё заново')}</Button>}
      </div>
      {failed && <p role="alert" className="text-xs text-destructive">{t('Не удалось загрузить модель распознавания')}</p>}
      {!progress && left !== null && !found.length && <p className="text-xs text-ink-soft">{t(left ? 'Пока никого не узнали. Можно просмотреть ещё.' : 'Новых совпадений нет.')}</p>}
      {found.map((s) => {
        const p = byId.get(s.personId)
        if (!p) return null
        return (
          <div key={s.key} className="flex items-center gap-2 border-t border-border pt-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.thumb} alt="" className="size-12 flex-none rounded-md object-cover" />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-ink-soft">{t('Похоже, это')}</div>
              <div className="truncate">{personName(p)}</div>
            </div>
            <Button size="sm" title={t(p.avatarMediaId ? 'Отметить на этом фото' : 'Отметить на этом фото и поставить портрет')} onClick={() => accept(s, !p.avatarMediaId)}><Check /> {t('Да')}</Button>
            <Button variant="ghost" size="sm" title={t('Это другой человек')} onClick={() => refuse(s)}><X /> {t('Нет')}</Button>
          </div>
        )
      })}
    </div>
  )
}
