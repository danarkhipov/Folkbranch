// What GigaAM v3 reads and writes: 64 log-mel bands from 20 ms windows every 10 ms, and one letter or nothing per step.
const N = 320
const HOP = 160
export const MELS = 64
const BINS = N / 2 + 1
const hann = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N))
const COS = Float32Array.from({ length: N }, (_, i) => Math.cos((2 * Math.PI * i) / N))
const SIN = Float32Array.from({ length: N }, (_, i) => Math.sin((2 * Math.PI * i) / N))
const toMel = (f: number) => 2595 * Math.log10(1 + f / 700)
const fromMel = (m: number) => 700 * (10 ** (m / 2595) - 1)
const bands = (() => {
  const points = Array.from({ length: MELS + 2 }, (_, i) => fromMel((toMel(8000) * i) / (MELS + 1)))
  return Array.from({ length: MELS }, (_, m) => Float32Array.from({ length: BINS }, (_, k) => {
    const f = (8000 * k) / (BINS - 1)
    return Math.max(0, Math.min((f - points[m]) / (points[m + 1] - points[m]), (points[m + 2] - f) / (points[m + 2] - points[m + 1])))
  }))
})()

/** Rows of bands, one column per step, as the model takes them. */
export function gigaamFeatures(samples: Float32Array) {
  const steps = Math.max(1, Math.floor((samples.length - N) / HOP) + 1)
  const out = new Float32Array(MELS * steps)
  const frame = new Float32Array(N)
  const power = new Float32Array(BINS)
  for (let t = 0; t < steps; t++) {
    for (let i = 0; i < N; i++) frame[i] = (samples[t * HOP + i] ?? 0) * hann[i]
    for (let k = 0; k < BINS; k++) {
      let re = 0, im = 0
      for (let n = 0; n < N; n++) { const at = (k * n) % N; re += frame[n] * COS[at]; im -= frame[n] * SIN[at] }
      power[k] = re * re + im * im
    }
    for (let m = 0; m < MELS; m++) {
      let sum = 0
      const band = bands[m]
      for (let k = 0; k < BINS; k++) sum += band[k] * power[k]
      out[m * steps + t] = Math.log(Math.min(1e9, Math.max(1e-9, sum)))
    }
  }
  return { features: out, steps }
}

/** The likeliest letter at each step, repeats and pauses taken out. The last entry of the alphabet is the pause. */
export function readLetters(scores: ArrayLike<number>, steps: number, size: number, alphabet: string[]) {
  let last = -1
  let text = ''
  for (let t = 0; t < steps; t++) {
    let best = 0
    let top = -Infinity
    for (let v = 0; v < size; v++) if (scores[t * size + v] > top) { top = scores[t * size + v]; best = v }
    if (best !== last && best !== size - 1 && best !== 0) text += alphabet[best]
    last = best
  }
  return text.replaceAll('▁', ' ').replace(/\s+/g, ' ').trim()
}
