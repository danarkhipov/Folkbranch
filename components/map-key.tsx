'use client'
// What the map's marks mean, one press away, as a printed map's key: the event glyphs, the numbered stops, why the
// lines curve, and what a faded face or a dashed way says. Nothing in it is needed to use the map; all of it answers
// "what is this?" without guessing.
import { HelpCircle } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useApp } from '@/lib/client'
import type { EventKind } from '@/lib/map-timeline'
import { GLYPH } from './map-people'

const EVENTS: [EventKind, string][] = [['birth', 'рождение'], ['death', 'смерть'], ['union', 'брак или союз'], ['move', 'переезд, место жительства'], ['work', 'работа, служба, учёба']]

export function MapKey() {
  const { t } = useApp()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="bar-btn !px-0" aria-label={t('Что значат знаки на карте')} title={t('Что значат знаки на карте')}><HelpCircle size={15} /></button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="map-key w-72 max-w-[calc(100vw-24px)] p-3 text-sm">
        <h3 className="mb-1.5 font-serif text-base text-ink">{t('Знаки на карте')}</h3>
        <ul className="flex flex-col gap-1">
          {EVENTS.map(([k, text]) => <li key={k} className="flex items-center gap-2"><b className="map-key-glyph" aria-hidden>{GLYPH[k]}</b>{t(text)}</li>)}
          <li className="flex items-center gap-2"><b className="map-key-stop" aria-hidden>2</b>{t('остановка в жизни человека, по порядку')}</li>
          <li className="flex items-center gap-2"><span className="map-key-line ahead" aria-hidden />{t('путь, до которого время ещё не дошло')}</li>
          <li className="flex items-center gap-2"><span className="map-key-face" aria-hidden />{t('где человек дальше — неизвестно')}</li>
        </ul>
        <p className="mt-2 text-xs text-ink-soft">{t('Линии изогнуты, потому что показывают кратчайший путь по земному шару.')}</p>
      </PopoverContent>
    </Popover>
  )
}
