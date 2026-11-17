// The speech presets, checked against the services' current documentation.
import { describe, expect, it } from 'vitest'
import { sttPreset } from '../lib/transcribe/presets'

describe('cloud speech presets', () => {
  it('uses Mistral\'s current Voxtral model ids', () => {
    // https://docs.mistral.ai/studio/audio/speech-to-text/transcribe-files.md
    expect(sttPreset('mistral')!.models.map((m) => m.id)).toEqual(['voxtral-mini-transcribe-3', 'voxtral-small-transcribe-3'])
    expect(sttPreset('mistral')!.models.some((m) => m.id === 'voxtral-mini-transcribe-latest')).toBe(false)
  })

  it('offers only the models SiliconFlow lists for /audio/transcriptions', () => {
    // https://docs.siliconflow.cn/en/api-reference/audio/create-audio-transcriptions
    expect(sttPreset('siliconflow')!.models.map((m) => m.id)).toEqual(['FunAudioLLM/SenseVoiceSmall', 'TeleAI/TeleSpeechASR'])
  })

  it('keeps the Groq line and its ten-second minimum billing', () => {
    // https://console.groq.com/docs/speech-to-text
    expect(sttPreset('groq')!.models.map((m) => m.id)).toEqual(['whisper-large-v3-turbo', 'whisper-large-v3'])
    expect(sttPreset('groq')!.minSeconds).toBe(10)
  })
})
