export const RATE = 16000
/** The length the speech model reads at once, a little under its limit of thirty seconds. */
const MAX = 28

/**
 * Cuts a recording where it is quietest near each limit, so no word is cut in half.
 * Returns where each piece starts and ends, covering everything with no overlap.
 */
export function splitAtQuiet(samples: Float32Array, rate = RATE, maxSeconds = MAX): [number, number][] {
  const out: [number, number][] = []
  const limit = Math.floor(maxSeconds * rate)
  const look = Math.floor(rate * 3)
  const step = Math.floor(rate * 0.05)
  let from = 0
  while (samples.length - from > limit) {
    let cut = from + limit
    let least = Infinity
    for (let at = from + limit - look; at + step <= from + limit; at += step) {
      let sum = 0
      for (let i = at; i < at + step; i++) sum += Math.abs(samples[i])
      if (sum < least) { least = sum; cut = at + Math.floor(step / 2) }
    }
    out.push([from, cut])
    from = cut
  }
  if (from < samples.length) out.push([from, samples.length])
  return out
}

/** Any recording the browser can play, as the one sound format the model reads. */
export async function decodeSpeech(blob: Blob) {
  const context = new OfflineAudioContext(1, 1, RATE)
  const decoded = await context.decodeAudioData(await blob.arrayBuffer())
  const mono = new OfflineAudioContext(1, Math.ceil(decoded.duration * RATE), RATE)
  const source = mono.createBufferSource()
  source.buffer = decoded
  source.connect(mono.destination)
  source.start()
  return (await mono.startRendering()).getChannelData(0)
}
