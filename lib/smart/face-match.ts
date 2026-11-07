export interface Guess { personId: string; score: number }

/**
 * Below this the guess is shown to nobody: a wrong name on a relative is worse than no name.
 * Measured on portraits of two people: the same person scored 0.46 to 0.51, different people 0.04 to 0.19.
 */
export const SAME_PERSON = 0.4

/** Each person by their closest photo; nothing at all if nobody is close enough or two people are equally close. */
export function bestMatch(scores: { personId: string; score: number }[]): Guess | null {
  const best = new Map<string, number>()
  for (const s of scores) best.set(s.personId, Math.max(best.get(s.personId) ?? 0, s.score))
  const [first, second] = [...best].sort((a, b) => b[1] - a[1])
  if (!first || first[1] < SAME_PERSON || (second && first[1] - second[1] < 0.08)) return null
  return { personId: first[0], score: first[1] }
}
