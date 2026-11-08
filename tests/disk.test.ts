import { describe, expect, it } from 'vitest'
import { lowOnRoom } from '../lib/ops/disk'

const stat = (freeMB: number, totalMB: number) => ({ bavail: freeMB, blocks: totalMB, bsize: 1024 ** 2 })

describe('low on room', () => {
  it('is not low on a small volume that is almost empty', () => expect(lowOnRoom(stat(982, 1000))).toBe(false))
  it('is low when a small volume is nearly full', () => expect(lowOnRoom(stat(40, 1000))).toBe(true))
  it('is low under a gigabyte only on a big disk', () => {
    expect(lowOnRoom(stat(900, 100_000))).toBe(true)
    expect(lowOnRoom(stat(2000, 100_000))).toBe(false)
  })
})
