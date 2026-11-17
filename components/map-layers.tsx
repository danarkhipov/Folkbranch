'use client'
// The map's layers, in the corner with the zoom, as map apps keep them. Every row is a switch or a check box that
// changes the map at once, so it is plain what is shown and what is not: people, event marks, routes, which past moves
// stay, and which kinds of event count at all (a place of birth, of marriage, of a move, of work, of death). Under it,
// folded away, what the map's own marks mean. The button says by a dot when something is switched off.
import { Check, Layers } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SwitchRow } from '@/components/ui/switch'
import { useApp } from '@/lib/client'
import { GLYPH } from '@/lib/map-glyphs'
import { isChanged, KINDS, resetLayers, setLayers, useLayers } from '@/lib/map-layers'
import type { EventKind } from '@/lib/map-timeline'

const KIND_TEXT: Record<EventKind, string> = {
  birth: 'Рождения', union: 'Браки и союзы', move: 'Переезды и места жительства', work: 'Работа, служба, учёба', death: 'Смерти', other: 'Прочее',
}

export function MapLayers() {
  const { t } = useApp()
  const layers = useLayers()
  const changed = isChanged(layers)
  const shownKinds = KINDS.length - layers.hidden.length
  const toggleKind = (k: EventKind) => setLayers({ hidden: layers.hidden.includes(k) ? layers.hidden.filter((x) => x !== k) : [...layers.hidden, k] })
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="bar-btn relative" aria-label={t('Слои карты')} title={changed ? t('Слои карты: что-то выключено') : t('Слои карты')}>
          <Layers size={16} />
          {changed && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-accent ring-2 ring-paper" aria-hidden />}
        </button>
      </PopoverTrigger>
      <PopoverContent side="left" align="end" collisionPadding={8} className="map-key w-72 max-w-[calc(100vw-24px)] p-3 text-sm">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h3 className="font-serif text-base text-ink">{t('Слои карты')}</h3>
          {changed && <button type="button" className="text-xs text-ink-soft underline underline-offset-2 hover:text-ink" onClick={resetLayers}>{t('Сбросить')}</button>}
        </div>
        <div className="flex flex-col divide-y divide-border">
          <SwitchRow title={t('Люди')} description={t('Лица на карте')} checked={layers.people} disabled={layers.people && !layers.events} onChange={(on) => setLayers({ people: on })} />
          <SwitchRow title={t('События')} description={t('Значки рождений, браков и других событий')} checked={layers.events} disabled={layers.events && !layers.people} onChange={(on) => setLayers({ events: on })} />
          <SwitchRow title={t('Маршруты')} description={t('Линии переездов')} checked={layers.trails} onChange={(on) => setLayers({ trails: on })} />
          <SwitchRow title={t('Все прошлые переезды')} description={layers.routes === 'all' ? t('Все переезды складываются в узор, по которому видно, куда расходилась семья.') : t('Выключено: виден последний переезд каждого, поколение, потом он исчезает.')} checked={layers.routes === 'all'} disabled={!layers.trails} onChange={(on) => setLayers({ routes: on ? 'all' : 'recent' })} />
        </div>
        <h3 className="mb-1 mt-3 font-serif text-base text-ink">{t('Какие места показывать')}</h3>
        <ul role="group" aria-label={t('Какие места показывать')} className="flex flex-col">
          {KINDS.map((k) => {
            const on = !layers.hidden.includes(k)
            const last = on && shownKinds === 1
            return (
              <li key={k}>
                <button type="button" role="checkbox" aria-checked={on} disabled={last} title={last ? t('Должен остаться хотя бы один вид') : undefined} onClick={() => toggleKind(k)} className={`flex w-full items-center gap-2 py-1.5 text-left ${last ? 'opacity-60' : ''}`}>
                  <span className={`flex size-5 flex-none items-center justify-center rounded border ${on ? 'border-ink bg-ink text-white' : 'border-input bg-white'}`} aria-hidden>{on && <Check size={13} strokeWidth={3} />}</span>
                  <b className="map-key-glyph" aria-hidden>{GLYPH[k]}</b>
                  <span className={on ? 'text-ink' : 'text-ink-soft'}>{t(KIND_TEXT[k])}</span>
                </button>
              </li>
            )
          })}
        </ul>
        <details className="mt-2 border-t border-border pt-2 text-xs text-ink-soft">
          <summary className="cursor-pointer text-sm text-ink">{t('Что значат знаки')}</summary>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            <li className="flex items-center gap-2"><b className="map-key-stop" aria-hidden>2</b>{t('остановка в жизни человека, по порядку')}</li>
            <li className="flex items-center gap-2"><span className="map-key-line ahead" aria-hidden />{t('путь, до которого время ещё не дошло')}</li>
            <li className="flex items-center gap-2"><span className="map-key-face" aria-hidden />{t('где человек дальше — неизвестно')}</li>
          </ul>
          <p className="mt-1.5">{t('Линия соединяет два места жизни почти по прямой: это переезд, а не дорога. Путь туда и обратно чуть расходится.')}</p>
        </details>
      </PopoverContent>
    </Popover>
  )
}
