// A quiet portrait for anyone without a photo, in the tones of an old photograph: a person, not a
// likeness. Drawn here, so no outside service or licence is involved, and the same person always
// gets the same one. Checked at the size the chart really shows, where only large shapes survive,
// so men and women differ by shoulders, hair and the colour of their clothes as well as by details.
import type { Person, Sex } from './types'

const hash = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261)
/** Spreads similar inputs apart, so each trait is chosen independently of the others. */
const mix = (h: number) => { let x = h; x = Math.imul(x ^ (x >>> 16), 2246822507); x = Math.imul(x ^ (x >>> 13), 3266489909); return (x ^ (x >>> 16)) >>> 0 }

const SKIN = '#edd9c0'
const SHADOW = '#d9bf9f'
const INK = '#4a3b2e'
const BACK: Record<Sex, string[]> = { M: ['#c6cdc9', '#bcc6c3', '#cbccc0'], F: ['#e4d6c3', '#e0cfc0', '#e6dbc6'], U: ['#d3ccbb'] }
// Dark enough to stand apart from the face and the background, greys included.
const HAIR = ['#2f2822', '#3f3329', '#574636', '#6b5a48', '#7d7669']
const CLOTH = ['#39362f', '#3f3a33', '#2f3338', '#4a4238', '#3a3d36']
const DRESS = ['#7a3b3b', '#5e4468', '#3d5a6b', '#6b4a35', '#3f5f55', '#8a5a44']

const bust = (cloth: string) => `<path d="M5 64C5 51 17 45.500 25.500 43L38.500 43C47 45.500 59 51 59 64Z" fill="${cloth}"/>`
const neck = `<path d="M27.500 34L27.500 44.500Q32 49 36.500 44.500L36.500 34Z" fill="${SHADOW}"/>`
const head = `<ellipse cx="32" cy="25.500" rx="10.500" ry="13" fill="${SKIN}"/>`
const face = (brow: string, width: number) => `<g fill="none" stroke-linecap="round"><path d="M${28 - width} 22.800Q27.500 ${22.200 - width / 4} ${29.800} 22.800M${34.200} 22.800Q36.500 ${22.200 - width / 4} ${36 + width} 22.800" stroke="${brow}" stroke-width="${0.5 + width / 2.5}"/><path d="M32 26V29.200Q32 30 31 30" stroke="${SHADOW}" stroke-width=".7"/></g><ellipse cx="27.700" cy="25" rx="1.150" ry=".85" fill="${INK}"/><ellipse cx="36.300" cy="25" rx="1.150" ry=".85" fill="${INK}"/>`
const mouth = (color: string, w: number) => `<path d="M${32 - w} 33.300Q32 ${33.300 + w / 2.500} ${32 + w} 33.300" fill="none" stroke="${color}" stroke-width="1" stroke-linecap="round"/>`

// A narrower build for women: sloping shoulders, a longer neck, a smaller face.
const womanBust = (dress: string) => `<path d="M10 64C10 54 20 49 27 45.500L37 45.500C44 49 54 54 54 64Z" fill="${dress}"/>`
const womanNeck = `<path d="M28.500 33L28.200 44Q32 47.500 35.800 44L35.500 33Z" fill="${SHADOW}"/>`
const womanHead = `<path d="M22.500 23C22.500 15.500 27 12.500 32 12.500C37 12.500 41.500 15.500 41.500 23C41.500 31.500 36.500 37.500 32 37.500C27.500 37.500 22.500 31.500 22.500 23Z" fill="${SKIN}"/>`
const earrings = `<circle cx="22.200" cy="31" r="1" fill="#a8895a"/><circle cx="41.800" cy="31" r="1" fill="#a8895a"/>`

// Each takes the hair colour. Drawn over the head unless the name says otherwise.
const MEN_HAIR: ((c: string) => string)[] = [
  (c) => `<path d="M21.300 25C20 11 44 11 42.700 25C41.800 20.500 39 18.500 32 18.500C25 18.500 22.200 20.500 21.300 25Z" fill="${c}"/>`,
  (c) => `<path d="M21.300 26C19.500 11.500 44.500 10 42.700 26C42 21 40.500 19 36 18C31 19.500 25 19.500 23 20C22 22 21.600 24 21.300 26Z" fill="${c}"/>`,
  (c) => `<path d="M21.300 27C20.300 22 21.500 18 24 16C23.500 19 23 23 22.800 27ZM42.700 27C43.700 22 42.500 18 40 16C40.500 19 41 23 41.200 27Z" fill="${c}"/>`,
  (c) => `<path d="M21.300 24C20.500 18 23 15 26 14C30 12 37 12 40 15C43 17 43.400 21 42.700 24C41 20 39 17.500 37 17C33 16 28 16 26.500 17.500C24 18.500 22.300 21 21.300 24Z" fill="${c}"/>`,
  (c) => `<path d="M21.200 28C19 15 25 10 33 10C41 10 45 16 42.800 28C42 22 40 19 32 19C24 19 22 22 21.200 28Z" fill="${c}"/>`,
]
const MEN_FACE: ((c: string) => string)[] = [
  () => '',
  (c) => `<path d="M26.800 31.800C28.500 30.800 30.800 30.700 32 31.300C33.200 30.700 35.500 30.800 37.200 31.800C35.500 32.900 33.300 32.700 32 32.200C30.700 32.700 28.500 32.900 26.800 31.800Z" fill="${c}"/>`,
  (c) => `<path d="M21.600 27C22 33 24 39.500 32 40.500C40 39.500 42 33 42.400 27C41.500 30 39.500 31 37.500 30.500C35 29.500 33 30 32 30.500C31 30 29 29.500 26.500 30.500C24.500 31 22.500 30 21.600 27Z" fill="${c}"/>`,
  (c) => `<path d="M27.500 34.500C28.500 38 30 39.500 32 39.500C34 39.500 35.500 38 36.500 34.500C34.500 35.500 29.500 35.500 27.500 34.500ZM27 31.700C28.600 30.800 30.800 30.700 32 31.300C33.200 30.700 35.400 30.800 37 31.700C35.400 32.800 33.300 32.600 32 32.100C30.700 32.600 28.600 32.800 27 31.700Z" fill="${c}"/>`,
  (c) => `<path d="M21.500 26L21.500 32C22 34 23 35.500 24 36.500L23.500 28ZM42.500 26L42.500 32C42 34 41 35.500 40 36.500L40.500 28Z" fill="${c}"/>`,
]
const GLASSES = `<g fill="none" stroke="#4a4338" stroke-width=".6"><circle cx="27.500" cy="25" r="3.100"/><circle cx="36.500" cy="25" r="3.100"/><path d="M30.600 25H33.400"/></g>`
const MEN_CLOTHES: ((c: string) => string)[] = [
  // Jacket, shirt and tie.
  () => `<path d="M26 43.500L32 56L38 43.500L35.500 42.500L32 45L28.500 42.500Z" fill="#eee6d6"/><path d="M30.700 46L33.300 46L33.800 49L32 56L30.200 49Z" fill="#26231e"/>`,
  // A buttoned tunic with a standing collar.
  (c) => `<path d="M26.500 41.500L37.500 41.500L38 45.500Q32 48 26 45.500Z" fill="${c}" stroke="#16130f" stroke-width=".5"/><path d="M32 47V64" stroke="#16130f" stroke-width=".6"/><g fill="#a89a7c"><circle cx="32" cy="51" r=".8"/><circle cx="32" cy="56" r=".8"/><circle cx="32" cy="61" r=".8"/></g>`,
  // An open shirt collar.
  () => `<path d="M25.500 43L32 50.500L38.500 43L41 45.500L36 55L32 50.500L28 55L23 45.500Z" fill="#e6dcc8"/>`,
  // A coat with wide lapels.
  () => `<path d="M27 43.500L32 52L37 43.500L34.500 42.500L32 44L29.500 42.500Z" fill="#eee6d6"/><path d="M26 43.500L21 50L28 53L32 62L36 53L43 50L38 43.500L32 52Z" fill="#00000030"/>`,
]

// Each woman's hairstyle: what lies behind the shoulders, and what lies over the head.
const WOMEN_STYLES: { back: (c: string) => string; top: (c: string) => string; earrings?: boolean }[] = [
  // A bun at the crown, with a parting.
  { back: (c) => `<circle cx="32" cy="9.500" r="6.200" fill="${c}"/>`, top: (c) => `<path d="M21.800 25C19.500 9 44.500 9 42.200 25C41.500 20.500 39 17 32 15.500C25 17 22.500 20.500 21.800 25Z" fill="${c}"/>`, earrings: true },
  // Long, loose, past the shoulders.
  { back: (c) => `<path d="M32 7C18 7 16.500 18 16.500 28C16.500 39 14 47 11.500 55L27 52L37 52L52.500 55C50 47 47.500 39 47.500 28C47.500 18 46 7 32 7Z" fill="${c}"/>`, top: (c) => `<path d="M21.500 27C20 12 44 12 42.500 27C41.500 21 38 17.500 32 15C26 17.500 22.500 21 21.500 27Z" fill="${c}"/>` },
  // Chin-length, full at the sides.
  { back: (c) => `<path d="M32 7.500C19 7.500 17 18 17 26C17 33 18 38 20.500 41.500L28 39L36 39L43.500 41.500C46 38 47 33 47 26C47 18 45 7.500 32 7.500Z" fill="${c}"/>`, top: (c) => `<path d="M21.500 27C20 12 44 12 42.500 27C42 21 39 18 33 15.500C30 19 25 20.500 23 21C22 23 21.700 25 21.500 27Z" fill="${c}"/>` },
  // A headscarf: patterned cloth, hair just showing, tied under the chin.
  { back: (c) => `<path d="M32 7C18.500 7 16 18 17 27C18 36 22.500 41 25 46L39 46C41.500 41 46 36 47 27C48 18 45.500 7 32 7Z" fill="${c}"/>`, top: (c) => `<path d="M22 23C22 16 26 14 32 14C38 14 42 16 42 23C39 18.500 36 17.500 32 17.500C28 17.500 25 18.500 22 23Z" fill="#3f3329"/><g fill="#00000022"><circle cx="24" cy="11.500" r="1"/><circle cx="32" cy="9.500" r="1"/><circle cx="40" cy="11.500" r="1"/><circle cx="20" cy="19" r="1"/><circle cx="44" cy="19" r="1"/><circle cx="20" cy="29" r="1"/><circle cx="44" cy="29" r="1"/></g><path d="M26.500 45L32 39.500L37.500 45L35 52L32 46.500L29 52Z" fill="${c}" stroke="#00000025" stroke-width=".4"/>` },
  // A plait over one shoulder.
  { back: (c) => `<path d="M32 8C20 8 18 17 18 26C18 31 19 35 21 38L27 37L37 37L43 38C45 35 46 31 46 26C46 17 44 8 32 8Z" fill="${c}"/>`, top: (c) => `<path d="M21.500 26C20 12 44 12 42.500 26C41.500 20.500 38 18 32 16C26 18 22.500 20.500 21.500 26Z" fill="${c}"/><path d="M41 36C44 40 45 46 43 52C42.500 54 41.500 56 40 58" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round"/><path d="M41 36C44 40 45 46 43 52C42.500 54 41.500 56 40 58" fill="none" stroke="#00000030" stroke-width="4" stroke-dasharray="1 2.500"/>`, earrings: false },
  // A plait wound round the head like a crown.
  { back: (c) => `<path d="M32 8C21 8 19 18 19.500 26L44.500 26C45 18 43 8 32 8Z" fill="${c}"/>`, top: (c) => `<path d="M21.500 26C20 14 44 14 42.500 26C41.500 21 38 18.500 32 18.500C26 18.500 22.500 21 21.500 26Z" fill="${c}"/><path d="M20.500 18C25 10.500 39 10.500 43.500 18" fill="none" stroke="${c}" stroke-width="4.200" stroke-linecap="round"/><path d="M20.500 18C25 10.500 39 10.500 43.500 18" fill="none" stroke="#00000035" stroke-width="2.600" stroke-dasharray="1 2.200"/>`, earrings: true },
  // Soft waves to the shoulders.
  { back: (c) => `<path d="M32 7C19 7 16 16 16.500 25C15 31 17 34 15.500 39C15 44 19 46 22 46L28 42L36 42L42 46C45 46 49 44 48.500 39C47 34 49 31 47.500 25C48 16 45 7 32 7Z" fill="${c}"/>`, top: (c) => `<path d="M21.500 27C20 11 44 11 42.500 27C42 21 40 17.500 36 16C32 19 26 19 23.500 20C22.300 22 21.800 24.500 21.500 27Z" fill="${c}"/>` },
]
const WOMEN_CLOTHES: (() => string)[] = [
  // A high collar with a brooch.
  () => `<path d="M27.500 41Q32 43.500 36.500 41L37.500 47.500Q32 50.500 26.500 47.500Z" fill="#efe6d6"/><ellipse cx="32" cy="50" rx="1.700" ry="2.100" fill="#a8895a" stroke="#efe6d6" stroke-width=".5"/>`,
  // A round neckline with beads.
  () => `<path d="M26 46Q32 56 38 46Z" fill="${SKIN}"/><path d="M26.500 47Q32 56.500 37.500 47" fill="none" stroke="#efe6d6" stroke-width="1.700" stroke-dasharray=".1 2.300" stroke-linecap="round"/>`,
  // A shawl across the shoulders.
  () => `<path d="M12 62C15 55 21 50 27 46.500L32 56L37 46.500C43 50 49 55 52 62L32 59Z" fill="#00000028"/>`,
  // A white lace collar.
  () => `<path d="M26.500 45.500L32 51.500L37.500 45.500L42 49.500L35.500 55L32 51.500L28.500 55L22 49.500Z" fill="#efe6d6"/>`,
  // A V neckline.
  () => `<path d="M27 46L32 55L37 46Z" fill="${SKIN}"/>`,
]
const NEUTRAL = (cloth: string) => `<path d="M21.300 25C20 11 44 11 42.700 25C41.800 20.500 39 18.500 32 18.500C25 18.500 22.200 20.500 21.300 25Z" fill="${cloth}"/>`

function portrait(id: string, sex: Sex) {
  const h = hash(id)
  const roll = (salt: number) => mix(h + Math.imul(salt, 2654435761))
  const pick = <T>(list: T[], salt: number) => list[roll(salt) % list.length]
  const back = pick(BACK[sex], 1), cloth = pick(CLOTH, 2), hair = pick(HAIR, 3)
  let body: string
  if (sex === 'F') {
    // A headscarf is less common than the rest, and it is cloth rather than hair.
    // Hair worn up comes first: it suits the period more than hair worn loose.
    const style = WOMEN_STYLES[roll(4) % 16 === 0 ? 3 : [0, 0, 0, 5, 5, 4, 4, 2, 6, 1][roll(10) % 10]]
    const scarf = style === WOMEN_STYLES[3]
    const dress = pick(DRESS, 2)
    body = style.back(scarf ? pick(['#7a5f4b', '#6b6a55', '#7a4f4f', '#5a6470'], 8) : hair) + `<g transform="translate(0 -3)">${womanBust(dress)}</g>` + womanNeck + `<g transform="translate(0 -3)">${pick(WOMEN_CLOTHES, 9)()}</g>` + womanHead
      + style.top(scarf ? pick(['#7a5f4b', '#6b6a55', '#7a4f4f', '#5a6470'], 8) : hair) + face(hair, 0) + mouth('#a5726a', 1.500) + (style.earrings ? earrings : '')
  } else if (sex === 'M') {
    const glasses = roll(6) % 6 === 0
    const facial = pick(MEN_FACE, 5)
    body = bust(cloth) + neck + pick(MEN_CLOTHES, 7)(cloth) + head + pick(MEN_HAIR, 4)(hair) + face(hair, 1) + mouth('#9c7a62', 2.200) + facial(hair) + (glasses ? GLASSES : '')
  } else {
    body = bust('#6e6355') + neck + head + NEUTRAL('#6e6355') + face('#6e6355', 0)
  }
  // Framed close: at the size of a card only the head and shoulders can be told apart.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="7 2 50 50"><rect x="7" y="2" width="50" height="50" fill="${back}"/>${body}</svg>`
}

const cache = new Map<string, string>()

export function drawnAvatar(p: Pick<Person, 'id' | 'sex'>) {
  const key = `${p.id}:${p.sex}`
  let uri = cache.get(key)
  if (!uri) {
    uri = `data:image/svg+xml;utf8,${encodeURIComponent(portrait(p.id, p.sex))}`
    cache.set(key, uri)
  }
  return uri
}
