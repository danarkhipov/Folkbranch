'use client'
import type { Lang } from '../types'
import { decodeSpeech } from './audio'
import { chosen } from './models'
import { cloudChosen, transcribeCloud } from './cloud'
import { runSpeech } from './speech-run'

export type SpeechProgress =
  | { stage: 'preparing' }
  | { stage: 'download'; loaded: number; total: number }
  | { stage: 'reading'; share: number; text: string }

/** Nothing here leaves the device, unless this device chose the cloud. */
export async function transcribe(blob: Blob, lang: Lang, onProgress: (p: SpeechProgress) => void, signal: AbortSignal) {
  onProgress({ stage: 'preparing' })
  // On this device's own choice the recording goes through the server to the owner's speech service instead.
  if (cloudChosen()) {
    const text = await transcribeCloud(blob, lang, signal)
    onProgress({ stage: 'reading', share: 1, text })
    return text
  }
  let text = ''
  return runSpeech({ samples: await decodeSpeech(blob), language: lang === 'ru' ? 'russian' : 'english', model: chosen('speech').whisper?.repo }, (m) => {
    if (m.type === 'download') onProgress({ stage: 'download', loaded: m.loaded!, total: m.total! })
    else if (m.type === 'reading') onProgress({ stage: 'reading', share: m.done! / m.total!, text })
    else if (m.type === 'text') { text = m.text!; onProgress({ stage: 'reading', share: 1, text }) }
  }, signal)
}
