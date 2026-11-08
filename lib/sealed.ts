// Keys a person sets from the app are kept in the database encrypted with the server's secret,
// so a copy of the database alone opens nothing. Each use has its own purpose, and with it its own key.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { serverSecret } from './server-secret'

const box = (purpose: string) => createHash('sha256').update(`${purpose}:${serverSecret()}`).digest()

export function seal(text: string, purpose: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', box(purpose), iv)
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64')).join('.')
}

/** Null when the server's secret has changed since: the person is then asked for the key again. */
export function unseal(sealed: string, purpose: string) {
  try {
    const [iv, tag, body] = sealed.split('.').map((p) => Buffer.from(p, 'base64'))
    const decipher = createDecipheriv('aes-256-gcm', box(purpose), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
