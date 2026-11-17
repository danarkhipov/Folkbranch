// How the map looks with a big family: where a stack's name goes. Names lay across each other, so this is pinned here.
import { describe, expect, it } from 'vitest'
import { fanOffset, FAN_PX, namedFace, Taken, type Box } from '../lib/map-layout'

/** The half of a face's box, and of its name, in pixels (as components/map-people.ts draws them). */
const R = 15, NAME_H = 9

describe('where a stack of faces keeps its name', () => {
  /** The box a name takes beside face `i` of a fan, as components/map-people.ts lays it out. */
  const labelBox = (townX: number, y: number, i: number, w = 84): Box => [townX + fanOffset(i) + R, y - NAME_H, townX + fanOffset(i) + R + w, y + NAME_H]
  const stack = (townX: number, y: number, shown: number) => {
    const t = new Taken()
    for (let i = 0; i < shown; i++) t.add([townX + fanOffset(i) - R, y - R, townX + fanOffset(i) + R, y + R])
    return t
  }

  it('names the last face of the fan, not the first', () => {
    expect([1, 2, 3].map(namedFace)).toEqual([0, 1, 2])
    expect(namedFace(0)).toBe(0)
  })

  it('keeps the name clear of every face of its own stack', () => {
    const x = 400, y = 300, shown = 3
    const taken = stack(x, y, shown)
    // Beside the last face the name stands past the whole fan.
    expect(taken.hit(labelBox(x, y, namedFace(shown)))).toBe(false)
    // Beside the first face — where it used to be drawn — it lay across the second and third faces.
    expect(taken.hit(labelBox(x, y, 0))).toBe(true)
  })

  it('keeps the room it keeps: the box it takes is the box it is drawn in', () => {
    const x = 400, y = 300, shown = 3
    const taken = stack(x, y, shown)
    // The room reserved for a name is the box beside the last face, so a second name beside it is refused...
    const mine = labelBox(x, y, namedFace(shown))
    taken.add(mine)
    expect(taken.hit([mine[2] - 4, mine[1], mine[2] + 80, mine[3]])).toBe(true)
    // ...and one that is a face's width further out is free.
    expect(taken.hit([mine[2] + 2, mine[1] - 40, mine[2] + 80, mine[3] - 40])).toBe(false)
    // A fan of one is named at its own face, where it always was.
    expect(fanOffset(namedFace(1))).toBe(0)
    expect(FAN_PX).toBe(9)
  })
})
