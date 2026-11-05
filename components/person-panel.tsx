'use client'
import { useState, useContext } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { Maximize2, Minimize2, PencilLine, Trash2, X } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, Presence, useApp, usePersonSave } from '@/lib/client'
import { yourTerm } from '@/lib/kinship'
import { editValue,  } from '@/lib/claims'
import { patronymicFrom } from '@/lib/names'
import { cn } from '@/lib/utils'
import { type ClaimField, type PageMeta, type Person } from '@/lib/types'
import { PanelEdge, useStoredSize } from './panel-size'
import { useEsc } from './person-pickers'
import { Field } from './person-fields'
import { AvatarButton } from './person-avatar'
import { Pages } from './person-pages'
import { FamilyTab } from './person-family'
import { PhotosTab } from './person-photos'
import { Details } from './person-details'
import { StoriesTab } from './person-stories'

const SuggestDialog = dynamic(() => import('./suggest-dialog').then((m) => m.SuggestDialog), { ssr: false })

export function PersonPanel({ person, onClose, onDelete }: { person: Person; onClose: () => void; onDelete: (id: string) => void }) {
  const [width, setWidth] = useStoredSize('person-panel-width', 480, (w) => Math.round(Math.max(360, Math.min(w, window.innerWidth - 80))))
  const [height, setHeight] = useStoredSize('person-panel-height', 560, (h) => Math.round(Math.max(240, Math.min(h, window.innerHeight - 16))))
  const app = useApp()
  const { t, canEdit, me, family, lang, graph, byId, notify } = app
  const present = useContext(Presence)
  const hereToo = present.filter((o) => o.focusId === person.id).map((o) => o.name)
  const [full, setFull] = useState(false)
  useEsc(onClose)
  const qc = useQueryClient()
  const patch = usePersonSave(person, (e) => {
    const { status } = e as Error & { status?: number }
    if (status === 409 || status === 404) {
      notify(t(status === 409 ? 'Это поле только что изменил другой человек. Показано новое значение, проверьте его.' : 'Этого человека только что удалили.'))
      qc.invalidateQueries({ queryKey: ['graph'] })
    }
  })
  /** A name with versions keeps them in step: typing corrects the main one. */
  const saveName = (key: ClaimField) => (v: string) => patch.mutate(person.claims.some((c) => c.field === key) ? editValue(person, key, v) : { [key]: v })
  const { data: pageList } = useQuery({ queryKey: ['pages', person.id], queryFn: () => api<PageMeta[]>(`persons/${person.id}/pages`) })
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
  const [addPatronymic, setAddPatronymic] = useState(false)
  const [suggesting, setSuggesting] = useState(false)

  return (
    <aside className={cn('panel', full && 'full')} style={{ '--panel-w': `${width}px`, '--panel-h': `${height}px` } as React.CSSProperties}>
      <PanelEdge edge="left" label="Ширина карточки" width={width} home={480} onWidth={setWidth} className="max-sm:hidden" />
      <PanelEdge edge="top" label="Высота карточки" width={height} home={Math.round((typeof window === 'undefined' ? 800 : window.innerHeight) * 0.7)} onWidth={setHeight} className="sm:hidden" />
      <div className="absolute right-2 top-2 flex gap-0.5 z-10">
        {canEdit && <button className="bar-btn !p-0 w-7 !h-7 hover:!text-destructive" aria-label={t('Удалить человека')} title={t('Удалить человека')} onClick={() => onDelete(person.id)}><Trash2 size={14} /></button>}
        <button className="bar-btn !p-0 w-7 !h-7" aria-label={t(full ? 'Свернуть' : 'Развернуть')} title={t(full ? 'Свернуть' : 'Развернуть')} onClick={() => setFull(!full)}>{full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
        <button className="bar-btn !p-0 w-7 !h-7" aria-label={t('Закрыть')} title={t('Закрыть')} onClick={onClose}><X size={15} /></button>
      </div>

      <header className="flex items-center gap-3 pl-4 pr-24 pt-3 pb-2">
        <AvatarButton person={person} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5 font-serif text-lg font-medium leading-snug">
            <Field fit readOnly={ro} value={person.givenName} placeholder={t('Имя')} onSave={saveName('givenName')} />
            {(person.patronymic || addPatronymic) && <Field id="f-patronymic" fit readOnly={ro} value={person.patronymic} placeholder={t('Отчество')} onSave={saveName('patronymic')} />}
            <Field fit readOnly={ro} value={person.surname} placeholder={t('Фамилия')} onSave={saveName('surname')} />
          </div>
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-ink-soft [&>button]:whitespace-nowrap">
            {(person.maidenName || (!ro && person.sex === 'F')) && <Field fit readOnly={ro} value={person.maidenName} placeholder={t('девичья фамилия')} onSave={saveName('maidenName')} />}
            {!person.patronymic && !addPatronymic && !ro && lang === 'ru' && !suggested && <button className="pick hover:text-ink" onClick={() => { setAddPatronymic(true); setTimeout(() => document.getElementById('f-patronymic')?.focus(), 30) }}>{t('Добавить отчество')}</button>}
            {!person.patronymic && !ro && lang === 'ru' && suggested && <button className="pick !px-0 underline underline-offset-2 hover:text-ink" title={t('Подставить отчество по имени отца')} onClick={() => patch.mutate({ patronymic: suggested })}>{t('Добавить отчество')} «{suggested}»</button>}
            {toMe && <span className="text-rust">{yourTerm(toMe.label, person.sex, lang)}</span>}
            {me.personId === person.id && <span className="text-rust">{t('Это вы')}</span>}
            {hereToo.length > 0 && <span className="whitespace-nowrap">{t('Здесь также')}: {hereToo.join(', ')}</span>}
            {ro && !me.guest && <button className="pick !px-0 flex items-center gap-1 underline underline-offset-2 hover:text-ink" onClick={() => setSuggesting(true)}><PencilLine size={12} /> {t('Предложить правку')}</button>}
          </div>
        </div>
      </header>

      <Tabs value={tab ?? (pageList && !pageList.length && !canEdit ? 'family' : 'pages')} onValueChange={setTab} className="flex-1 min-h-0 flex flex-col gap-0">
        <TabsList className="panel-tabs mx-4 w-fit max-w-[calc(100%-2rem)] overflow-x-auto justify-start bg-muted">
          <TabsTrigger value="pages" className="text-sm">{t('Биография')}</TabsTrigger>
          <TabsTrigger value="details" className="text-sm">{t('Сведения')}</TabsTrigger>
          <TabsTrigger value="family" className="text-sm">{t('Семья')}</TabsTrigger>
          <TabsTrigger value="photos" className="text-sm">{t('Фото')}</TabsTrigger>
          <TabsTrigger value="stories" className="text-sm">{t('Рассказы')}</TabsTrigger>
        </TabsList>
        <TabsContent value="pages" className="flex-1 min-h-0 overflow-hidden"><Pages person={person} full={full} onDetails={() => go('details')} /></TabsContent>
        <TabsContent value="details" className="flex-1 min-h-0 overflow-auto pt-3">
          <Details person={person} patch={patch.mutateAsync} />
        </TabsContent>
        <TabsContent value="family" className="flex-1 min-h-0 overflow-auto pt-3"><FamilyTab person={person} /></TabsContent>
        <TabsContent value="photos" className="flex-1 min-h-0 overflow-auto"><PhotosTab person={person} /></TabsContent>
        <TabsContent value="stories" className="flex-1 min-h-0 overflow-auto"><StoriesTab person={person} /></TabsContent>
      </Tabs>
      {suggesting && <SuggestDialog person={person} onClose={() => setSuggesting(false)} />}
    </aside>
  )
}
