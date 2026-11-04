// A drawn portrait for anyone without a photo. Notionists is CC0 and is generated here in the
// browser, so no outside service is involved. The same person always gets the same drawing.
import { createAvatar } from '@dicebear/core'
import * as notionists from '@dicebear/notionists'
import type { Person, Sex } from './types'

const nums = (...n: number[]) => n.map((x) => `variant${String(x).padStart(2, '0')}`) as never[]

const HAIR: Record<Sex, never[]> = {
  F: nums(2, 4, 8, 10, 23, 28, 36, 37, 39, 41, 46, 47, 48, 58),
  M: nums(1, 5, 6, 7, 13, 15, 16, 21, 25, 27, 34, 35, 44, 49, 54, 55, 56),
  U: nums(11, 12, 17, 18, 22, 30, 31, 33),
}
export const TINT: Record<Sex, string> = { M: 'd5dfe0', F: 'efdccf', U: 'e7dfcd' }

const cache = new Map<string, string>()

export function drawnAvatar(p: Pick<Person, 'id' | 'sex'>) {
  const key = `${p.id}:${p.sex}`
  let uri = cache.get(key)
  if (!uri) {
    uri = createAvatar(notionists, {
      seed: p.id,
      hair: HAIR[p.sex],
      backgroundColor: [TINT[p.sex]],
      beardProbability: p.sex === 'M' ? 20 : 0,
      glassesProbability: 12,
      gestureProbability: 0,
      bodyIconProbability: 0,
    }).toDataUri()
    cache.set(key, uri)
  }
  return uri
}
