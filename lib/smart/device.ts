// How much this device can take. A browser reports little, and on purpose, so this is a rough guide and not a verdict.
export type Tier = 'weak' | 'normal' | 'strong'

export interface Device { cores: number | null; memoryGB: number | null; saveData: boolean; tier: Tier }

/** A phone or an old laptop should never be asked to run the larger model by default. */
export function rateDevice({ cores, memoryGB, saveData }: Omit<Device, 'tier'>): Tier {
  if (saveData || (memoryGB !== null && memoryGB <= 4) || (cores !== null && cores <= 4)) return 'weak'
  return cores !== null && cores >= 8 && (memoryGB === null || memoryGB >= 8) ? 'strong' : 'normal'
}

export function readDevice(): Device {
  const n = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } }
  const facts = { cores: n.hardwareConcurrency || null, memoryGB: n.deviceMemory ?? null, saveData: !!n.connection?.saveData }
  return { ...facts, tier: rateDevice(facts) }
}
