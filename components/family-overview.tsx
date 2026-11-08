'use client'
import { useMemo, useState } from 'react'
import { CalendarPlus } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useApp } from '@/lib/client'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ArchivesTab, PlacesTab } from './places-tab'
import { Button } from '@/components/ui/button'
import { comingDays, familyCalendar, familyNumbers, type DayKind } from '@/lib/family-dates'
import { personName } from '@/lib/types'

const WORD: Record<DayKind, string> = {
  birthday: 'День рождения', 'birth-memory': 'Со дня рождения', 'death-memory': 'Со дня смерти', wedding: 'Годовщина свадьбы', 'wedding-memory': 'Со дня свадьбы',
}

/** What is coming up in the family, and what it adds up to. Everything here is read from the cards. */
export function FamilyOverview({ onClose }: { onClose: () => void }) {
  const { t, graph, byId, focus, lang } = useApp()
  const [tab, setTab] = useState('dates')
  const days = useMemo(() => comingDays(graph), [graph])
  const numbers = useMemo(() => familyNumbers(graph), [graph])
  const open = (id: string) => { onClose(); focus(id, { center: true }) }
  const calendarDays = useMemo(() => (familyCalendar(graph, t).match(/BEGIN:VEVENT/g) ?? []).length, [graph, t])
  const saveCalendar = () => {
    const url = URL.createObjectURL(new Blob([familyCalendar(graph, t)], { type: 'text/calendar' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: 'family-days.ics' })
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const name = (id: string) => { const p = byId.get(id); return p ? personName(p) || t('Без названия') : '' }
  const when = (month: number, day: number) => new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(Date.UTC(2024, month - 1, day))
  const soon = (n: number) => (n === 0 ? t('Сегодня') : n === 1 ? t('Завтра') : null)
  const stat = (label: string, value: React.ReactNode) => <div className="flex items-baseline justify-between gap-3 border-b border-border py-1.5 last:border-0"><dt className="text-ink-soft">{label}</dt><dd className="min-w-0 text-right">{value}</dd></div>
  const person = (id: string) => <button className="pick underline underline-offset-2 hover:text-ink" onClick={() => open(id)}>{name(id)}</button>
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="flex max-h-[calc(100dvh-32px)] max-w-xl flex-col gap-4 overflow-y-auto text-sm sm:max-w-xl">
        <div>
          <DialogTitle className="font-serif text-lg font-medium">{t('Даты, места и архивы')}</DialogTitle>
          <DialogDescription className="text-ink-soft">{t('Памятные дни, семья в цифрах, места и архивы, о которых говорят карточки.')}</DialogDescription>
        </div>
        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-col gap-3">
        <TabsList className="self-start bg-muted">
          <TabsTrigger value="dates">{t('Даты')}</TabsTrigger>
          <TabsTrigger value="places">{t('Места')}</TabsTrigger>
          <TabsTrigger value="archives">{t('Архивы')}</TabsTrigger>
        </TabsList>
        <TabsContent value="places"><PlacesTab onOpen={open} /></TabsContent>
        <TabsContent value="archives"><ArchivesTab /></TabsContent>
        <TabsContent value="dates" className="flex flex-col gap-4">
        <section className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-medium">{t('Ближайшие даты')}</h3>
            <Button size="sm" variant="outline" disabled={!calendarDays} title={t(calendarDays ? 'Файл для календаря на телефоне или компьютере: дни рождения, годовщины и дни памяти каждый год.' : 'В календарь попадают даты с днём и месяцем, а таких пока нет.')} onClick={saveCalendar}><CalendarPlus /> {t('В календарь')}</Button>
          </div>
          {!days.length && <p className="text-ink-soft">{t('В ближайшие два месяца дат нет. Сюда попадают даты, записанные с днём и месяцем, например 12.03.1890.')}</p>}
          <ul className="flex flex-col">
            {days.map((d, i) => (
              <li key={i} className="flex items-baseline gap-3 border-b border-border py-1.5 last:border-0">
                <span className="w-24 flex-none text-ink-soft">{soon(d.daysAway) ?? when(d.month, d.day)}</span>
                <span className="min-w-0">
                  {d.personIds.map((id, j) => <span key={id}>{j > 0 && ` ${t('и')} `}<button className="pick font-medium underline-offset-2 hover:underline" onClick={() => open(id)}>{name(id)}</button></span>)}
                  <span className="block text-xs text-ink-soft">{t(WORD[d.kind])}: {d.years}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="flex flex-col">
          <h3 className="mb-1 text-base font-medium">{t('Семья в цифрах')}</h3>
          <dl>
            {stat(t('Людей'), numbers.people)}
            {stat(t('Из них живых'), numbers.living)}
            {stat(t('Поколений'), numbers.generations)}
            {numbers.earliest && stat(t('Самый ранний год рождения'), <>{numbers.earliest.year}, {person(numbers.earliest.id)}</>)}
            {numbers.oldest && stat(t('Самая долгая жизнь'), <>{numbers.oldest.age}, {person(numbers.oldest.id)}</>)}
            {numbers.surnames.length > 0 && stat(t('Частые фамилии'), numbers.surnames.map(([n, c]) => `${n} (${c})`).join(', '))}
            {numbers.places.length > 0 && stat(t('Частые места'), numbers.places.map(([n, c]) => `${n} (${c})`).join(', '))}
          </dl>
        </section>
        </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
