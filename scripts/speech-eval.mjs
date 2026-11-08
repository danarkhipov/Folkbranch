// How often a speech model gets a word wrong, the way the app runs it (q8). The numbers in lib/smart/models.ts come from this.
//   node scripts/speech-eval.mjs <folder> <model repo> [language]
// The folder holds clips.json ([{ i, text, dur }]) and clips/<i>.f32 (16 kHz mono float32 samples, e.g. made with ffmpeg
// from LibriSpeech test-other for English or bond005/sova_rudevices for Russian). Models are fetched from the Hugging Face hub.
import fs from 'node:fs'
import { env, pipeline } from '@huggingface/transformers'

const [dir, repo, language] = process.argv.slice(2)
env.cacheDir = `${dir}/hf`
const clips = JSON.parse(fs.readFileSync(`${dir}/clips.json`, 'utf8'))
const norm = (s) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()
const distance = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}
const read = await pipeline('automatic-speech-recognition', repo, { dtype: 'q8', device: 'cpu' })
let errors = 0, words = 0, audio = 0, spent = 0
for (const c of clips) {
  const buf = fs.readFileSync(`${dir}/clips/${c.i}.f32`)
  const samples = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4)
  // The same settings as the app's speech worker; a model made for English alone is not told the language.
  const options = { sampling_rate: 16000, no_repeat_ngram_size: 3, repetition_penalty: 1.1, max_new_tokens: 200, ...(repo.endsWith('.en') || !language ? {} : { language, task: 'transcribe' }) }
  const t = Date.now()
  const out = await read(samples, options)
  spent += (Date.now() - t) / 1000
  audio += c.dur
  const ref = norm(c.text).split(' ')
  errors += distance(ref, norm((Array.isArray(out) ? out[0] : out).text).split(' ').filter(Boolean))
  words += ref.length
}
console.log(JSON.stringify({ repo, wrongWordsPercent: +((errors / words) * 100).toFixed(1), words, timesFasterThanSpeech: +(audio / spent).toFixed(1) }))
