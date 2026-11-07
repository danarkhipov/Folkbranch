// Reads Russian speech away from the page, so the app stays usable however slow the device is.
import { splitAtQuiet } from './audio'
import { gigaamFeatures, MELS, readLetters } from './gigaam'
import { fromCache, ort, prepare, session } from './ort-files'

const send = (m: unknown) => (self as unknown as Worker).postMessage(m)

self.onmessage = async ({ data: job }: MessageEvent<{ samples: Float32Array; threads: number }>) => {
  try {
    await prepare(job.threads)
    const alphabet = (await (await fromCache('gigaam-vocab.txt')).text()).trim().split('\n').map((line) => line.slice(0, line.lastIndexOf(' ')))
    const s = await session('gigaam.onnx')
    const pieces = splitAtQuiet(job.samples)
    let text = ''
    for (let i = 0; i < pieces.length; i++) {
      send({ type: 'reading', done: i, total: pieces.length })
      const { features, steps } = gigaamFeatures(job.samples.subarray(pieces[i][0], pieces[i][1]))
      const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', features, [1, MELS, steps]), [s.inputNames[1]]: new ort.Tensor('int64', BigInt64Array.from([BigInt(steps)]), [1]) })
      const scores = out[s.outputNames[0]]
      text = `${text} ${readLetters(scores.data as Float32Array, scores.dims[1], scores.dims[2], alphabet)}`.trim()
      send({ type: 'text', text })
    }
    send({ type: 'done', text })
  } catch (e) {
    send({ type: 'error', message: String((e as Error).message ?? e) })
  }
}
