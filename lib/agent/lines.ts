// A "line" is one family of models that we tested, such as "Gemini Flash-Lite". The tested model is its floor: the app
// uses the newest model of the line that the service lists, never one older than the floor, so next year's release is
// picked up with no change here. A new line is added only after it has been tested.
import type { PresetId } from './presets'

export interface Line {
  /** Matches the ids of this line; the first group holds the version, written with dots or dashes. */
  match: RegExp
  /** The model that was tested. Anything of this line at least as new qualifies. */
  floor: string
  /** What the tests said, so nobody has to guess: 'tested' only after a benchmark, 'provisional' before. */
  status: 'tested' | 'provisional'
}

const num = (s: string) => s.split(/[.-]/).filter(Boolean).map(Number)

/** The version inside an id of the line, or null when the id is not of it. */
export function versionOf(id: string, line: Line): number[] | null {
  const m = line.match.exec(id)
  return m?.[1] ? num(m[1]) : null
}

export function compare(a: number[], b: number[]) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0)
  return 0
}

/**
 * The newest listed model of the line that is not older than the floor, or null when the service lists none:
 * then the floor itself stays in use. Ids with a suffix of a later date (-1017) lose to the plain newest version only by version.
 */
export function newestOfLine(listed: string[], line: Line): string | null {
  const floor = versionOf(line.floor, line)
  if (!floor) return null
  let best: { id: string; version: number[] } | null = null
  for (const id of listed) {
    const version = versionOf(id, line)
    if (!version || compare(version, floor) < 0) continue
    if (!best || compare(version, best.version) > 0) best = { id, version }
  }
  return best?.id ?? null
}

/** Which line a model belongs to, for keeping to the same line when the model is refreshed. */
export function lineOf(id: string, lines: Line[]) {
  return lines.find((l) => versionOf(id, l)) ?? null
}

/** The lines we have tested, by service. The first of each is the default. Services without a line keep the model chosen at connection. */
export const LINES: Partial<Record<PresetId, Line[]>> = {
  // Through OpenRouter, 9 November 2026, 97 scenarios each (docs/MODEL_BENCHMARK.md). Qwen 3.7 Flash passed 72 and is not offered.
  openrouter: [
    { match: /^openai\/gpt-(\d+(?:\.\d+)*)-luna$/, floor: 'openai/gpt-6-luna', status: 'tested' },
    { match: /^deepseek\/deepseek-v(\d+(?:\.\d+)*)-flash(?:-\d+)?$/, floor: 'deepseek/deepseek-v4.1-flash-1017', status: 'tested' },
    { match: /^minimax\/minimax-m(\d+(?:\.\d+)*)-flash$/, floor: 'minimax/minimax-m3.1-flash', status: 'tested' },
    { match: /^z-ai\/glm-(\d+(?:\.\d+)*)-flash$/, floor: 'z-ai/glm-5.3-flash', status: 'tested' },
    { match: /^anthropic\/claude-haiku-(\d+(?:\.\d+)*)$/, floor: 'anthropic/claude-haiku-5.5', status: 'tested' },
  ],
  // The same models as above, reached directly: the test ran through OpenRouter.
  anthropic: [{ match: /^claude-haiku-(\d+(?:-\d+)*)$/, floor: 'claude-haiku-5-5', status: 'tested' }],
  openai: [{ match: /^gpt-(\d+(?:[.-]\d+)*)-luna$/, floor: 'gpt-6-luna', status: 'tested' }],
  google: [{ match: /^gemini-(\d+(?:\.\d+)*)-flash-lite$/, floor: 'gemini-3.1-flash-lite', status: 'provisional' }],
}

/** What each service charges nothing for, and what that costs in data, as the services' own terms said on 8 November 2026. */
export interface Plans {
  /** Is there a free plan at all, and what happens to what is sent. */
  free: null | { data: 'private' | 'trains' | 'mixed'; note: string }
  paid: string
}
