'use client'
import { avatarUrl } from '@/lib/client'
import type { Person } from '@/lib/types'

/** Apart from the pickers, which bring a search list with them: the first screen needs only this. */
export function Mini({ person, size = 24 }: { person: Person; size?: number }) {
  return (
    <span className="rounded-full overflow-hidden bg-[#e7dfcd] flex-none block" style={{ width: size, height: size }}>
      <img src={avatarUrl(person)} alt="" className="w-full h-full object-cover" />
    </span>
  )
}
