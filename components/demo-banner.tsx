import { translate } from '@/lib/i18n'
import type { Lang } from '@/lib/types'

/**
 * A thin line above every screen of the public demo. The app sits below it in a box of its own, so what the app
 * fixes to the window is fixed to that box and nothing runs under the line.
 */
export function DemoShell({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <div role="note" data-demo-banner className="z-40 shrink-0 bg-ink px-3 py-1 text-center text-xs leading-snug text-paper">
        {translate(lang, 'Demo with an invented family. Everything is deleted after an hour, so do not upload real family data.')}{' '}
        <a href="https://folkbranch.com/#install" target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-2">{translate(lang, 'Install your own')}</a>
      </div>
      <div className="relative min-h-0 flex-1 overflow-auto" style={{ transform: 'translateZ(0)' }}>{children}</div>
    </div>
  )
}
