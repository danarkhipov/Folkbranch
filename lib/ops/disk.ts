// "Low on room" is relative: a small volume with plenty of its own space left is not in trouble.
const GB = 1024 ** 3
const FLOOR = 64 * 1024 ** 2

export function lowOnRoom(s: { bavail: number; blocks: number; bsize: number }) {
  const free = s.bavail * s.bsize
  const limit = Math.max(FLOOR, Math.min(GB, 0.1 * s.blocks * s.bsize))
  return free < limit
}
