'use client'
import { useApp } from '@/lib/client'

export type Pay = 'all' | 'paid' | 'free'
type Free = { data: 'private' | 'trains' | 'mixed' | 'unknown'; note: string } | null | undefined

const FREE_WORDS = {
  private: ['Бесплатно, данные не используются', 'text-[#2f7d4f]'],
  trains: ['Бесплатно, но данные используются', 'text-rust'],
  mixed: ['Бесплатно, условия разные', 'text-rust'],
  unknown: ['Бесплатно, про данные не ясно', 'text-rust'],
} as const

/** How to pay: with money, with data, or not at all. Chosen first, so the list below shows only what fits. */
export function PayChoice({ value, onChange }: { value: Pay; onChange: (v: Pay) => void }) {
  const { t } = useApp()
  const options: [Pay, string, string][] = [
    ['paid', 'Платно', 'Данные не используются. Для голоса и сканов семьи лучше так'],
    ['free', 'Бесплатно', 'С ограничениями. Узнайте, что происходит с данными'],
    ['all', 'Показать все', ''],
  ]
  return (
    <div role="radiogroup" aria-label={t('Как будете платить?')} className="flex flex-col gap-1.5">
      <p className="text-xs text-ink-soft">{t('Как будете платить?')}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([id, title]) => (
          <button key={id} type="button" role="radio" aria-checked={value === id} onClick={() => onChange(id)} className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${value === id ? 'border-ink bg-white' : 'border-border hover:border-ink-faint'}`}>{t(title)}</button>
        ))}
      </div>
      {options.find(([id]) => id === value)?.[2] && <p className="text-xs text-ink-soft">{t(options.find(([id]) => id === value)![2])}</p>}
    </div>
  )
}

/** The free and the paid plan of a service in two lines, so "free" is never read without what it costs in data. */
export function PlanLines({ free, paid, show }: { free: Free; paid?: string; show: Pay }) {
  const { t } = useApp()
  return (
    <span className="mt-1 flex flex-col gap-0.5 text-xs">
      {show !== 'paid' && free && <span><b className={`font-medium ${FREE_WORDS[free.data][1]}`}>{t(FREE_WORDS[free.data][0])}.</b> <span className="text-ink-soft">{t(free.note)}</span></span>}
      {show !== 'free' && paid && <span className="text-ink-soft">{t(paid)}</span>}
    </span>
  )
}
