import fs from 'node:fs'
import path from 'node:path'

/** Where links should lead while ./folkbranch share has this computer open to the internet, if it does. */
export function sharedAddress() {
  try {
    const dir = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || './data')
    const value = fs.readFileSync(path.join(/*turbopackIgnore: true*/ dir, 'public-address'), 'utf8').trim()
    return /^https:\/\/[a-z0-9.-]+$/.test(value) ? value : null
  } catch {
    return null
  }
}

/** The addresses people open the app at: the one set by hand first, then the one the platform gave. */
export function publicOrigins() {
  const { BETTER_AUTH_URL, RAILWAY_PUBLIC_DOMAIN } = process.env
  return [BETTER_AUTH_URL, RAILWAY_PUBLIC_DOMAIN && `https://${RAILWAY_PUBLIC_DOMAIN}`].filter((u): u is string => !!u).map((u) => u.replace(/\/+$/, ''))
}

export const publicUrl = () => publicOrigins()[0] ?? `http://localhost:${process.env.PORT || 3417}`
