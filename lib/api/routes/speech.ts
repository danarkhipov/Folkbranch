import { OpError } from '@/lib/ops/core'
import { removeTranscription, saveTranscription, testTranscription, transcribe, transcriptionInfo, transcriptionStatus } from '@/lib/transcribe/service'
import { human, type Route } from '../router'

export const speechRoutes: Route[] = [
  human('GET', 'transcription/info', 'Whether recordings can be turned into text in the cloud, and where they go', () => transcriptionInfo()),
  human('GET', 'transcription', 'The cloud transcription setup, for the owner', ({ actor }) => transcriptionStatus(actor)),
  human('PUT', 'transcription', 'Connect a speech service', async ({ actor, body }) => saveTranscription(actor, await body())),
  human('DELETE', 'transcription', 'Disconnect the speech service', ({ actor }) => removeTranscription(actor)),
  human('POST', 'transcription/test', 'Try the speech service with two seconds of silence', ({ actor }) => testTranscription(actor)),
  human('POST', 'transcribe', 'Turn a recording into text through the owner\'s speech service', async ({ actor, req }) => {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) throw new OpError(400, 'file required')
    return transcribe(actor, { bytes: Buffer.from(await file.arrayBuffer()), name: file.name, mime: file.type }, { language: form.get('language')?.toString() ?? null, seconds: Number(form.get('seconds')) || 0 })
  }),
]
