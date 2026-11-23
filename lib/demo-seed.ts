// A demo copy starts as an archive of the invented family with its owner already made: no setup screen, no sign-up.
import { randomBytes } from 'node:crypto'
import { getAuth } from './auth'
import { loadDemo } from './demo'
import { setSetting } from './ops/app-config'
import { hasUsers } from './ops/settings'

const WORDS = { en: { owner: 'Demo owner', family: 'Whitlock' }, ru: { owner: 'Владелец демо', family: 'Соколовы' } } as const

/** The language of the family a copy starts with: DEMO_LANG, English unless it says ru. */
export const demoLang = (): 'en' | 'ru' =>(process.env.DEMO_LANG === 'ru' ? 'ru' : 'en')

export async function seedDemo() {
  if (hasUsers()) return
  const lang = demoLang()
  const w = WORDS[lang]
  const context = await getAuth().$context
  // The same stand-in address as an invited relative's: Better Auth wants one, and nobody can use it.
  const adapter = context.internalAdapter as unknown as { createUser(user: Record<string, unknown>): Promise<{ id: string }> }
  const owner = await adapter.createUser({ name: w.owner, email: `${randomBytes(9).toString('hex')}@invite.invalid`, emailVerified: false, role: 'owner', personId: null })
  setSetting('familyName', w.family)
  setSetting('language', lang)
  setSetting('assistantEnabled', '1')
  await loadDemo(owner.id, w.owner, lang)
}
