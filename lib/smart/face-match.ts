export interface Guess { personId: string; score: number }

/**
 * Below this the guess is shown to nobody: a wrong name on a relative is worse than no name.
 * Measured with SFace on 1000 LFW pairs, half of them blurred and grey: at 0.36 no two different people passed,
 * and 5 to 7 in a hundred pairs of the same person were missed.
 */
export const SAME_PERSON = 0.36

export const similarity = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i], 0)

/** Each person by their closest photo; nothing at all if nobody is close enough or two people are about equally close. */
export function bestMatch(scores: { personId: string; score: number }[]): Guess | null {
  const best = new Map<string, number>()
  for (const s of scores) best.set(s.personId, Math.max(best.get(s.personId) ?? 0, s.score))
  const [first, second] = [...best].sort((a, b) => b[1] - a[1])
  if (!first || first[1] < SAME_PERSON || (second && first[1] - second[1] < 0.06)) return null
  return { personId: first[0], score: first[1] }
}
