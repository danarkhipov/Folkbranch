// The speech services an owner can connect for cloud transcription. Plain data, so the browser shows them too.
export type SttId = 'openrouter' | 'groq' | 'openai' | 'mistral' | 'siliconflow' | 'custom'

export interface SttPreset {
  id: SttId
  label: string
  /** Where the audio goes: shown to everyone before they use it. */
  where: string
  base: string
  /** openai: a file in a form, as OpenAI does it. openrouter: base64 in JSON. */
  style: 'openai' | 'openrouter'
  keysUrl: string
  pitch: string
  /** The first is the default. Prices are dollars per minute of audio as the service listed them in November 2026, a guide that changes. */
  models: { id: string; label: string; perMinute: number | null; note?: string }[]
  /** Billed at least this many seconds for each request. */
  minSeconds?: number
  /** Free plan and what it costs in data, from the service's own terms on 8 November 2026; null when there is none or it is not known. */
  /** What our own run found, when there was one: services without it are shown as not tested. */
  tested?: string
  free?: { data: 'private' | 'trains' | 'mixed' | 'unknown'; note: string }
  /** The key of the assistant, when that is the same service, can be reused. */
  assistantKey?: 'openrouter' | 'openai'
}

export const STT_PRESETS: SttPreset[] = [
  {
    id: 'openrouter', label: 'OpenRouter', where: 'OpenRouter и сервис, который он выберет для модели', base: 'https://openrouter.ai/api/v1', style: 'openrouter', keysUrl: 'https://openrouter.ai/settings/keys', assistantKey: 'openrouter',
    tested: 'Проверено 9 ноября 2026 на 20 английских и 20 русских записях: Voxtral Mini ошибается в 2% английских слов и в 14% русских.',
    pitch: 'Один ключ для ассистента и расшифровки. Цена каждого запроса приходит в ответе, поэтому расход считается точно',
    models: [
      { id: 'mistralai/voxtral-mini-transcribe', label: 'Voxtral Mini (Mistral)', perMinute: 0.003, note: 'Дёшево и точно, много языков' },
      { id: 'openai/whisper-large-v3', label: 'Whisper large-v3', perMinute: null },
      { id: 'microsoft/mai-transcribe-2', label: 'MAI-Transcribe 2 (Microsoft)', perMinute: null, note: 'Одна из самых точных' },
    ],
  },
  {
    id: 'groq', label: 'Groq', where: 'Groq (США)', base: 'https://api.groq.com/openai/v1', style: 'openai', keysUrl: 'https://console.groq.com/keys', minSeconds: 10,
    tested: 'Проверено 9 ноября 2026 на 20 английских и 20 русских записях: Whisper turbo ошибается в 3% английских слов и в 19% русских. На бесплатном плане лимит 20 запросов в минуту на всех.',
    free: { data: 'private', note: 'Бесплатно: до 2 часов записи в час и 8 часов в день. Groq по договору не учится на ваших данных и по умолчанию не хранит их, логи до 30 дней только при сбоях.' },
    pitch: 'Самый дешёвый: около 4 центов за час записи, и есть бесплатный лимит. Тот же Whisper, быстро',
    models: [
      { id: 'whisper-large-v3-turbo', label: 'Whisper large-v3 turbo', perMinute: 0.04 / 60, note: 'Около 4,6% ошибок на английском' },
      { id: 'whisper-large-v3', label: 'Whisper large-v3', perMinute: 0.111 / 60, note: 'Чуть точнее для редких языков' },
    ],
  },
  {
    id: 'openai', label: 'OpenAI', where: 'OpenAI (США)', base: 'https://api.openai.com/v1', style: 'openai', keysUrl: 'https://platform.openai.com/api-keys', assistantKey: 'openai',
    pitch: 'Одна из самых точных: около 3,3% ошибок на английском, 27 центов за час',
    models: [{ id: 'gpt-transcribe', label: 'GPT Transcribe', perMinute: 0.0045 }],
  },
  {
    id: 'mistral', label: 'Mistral (Voxtral)', where: 'Mistral AI (Франция)', base: 'https://api.mistral.ai/v1', style: 'openai', keysUrl: 'https://console.mistral.ai/api-keys',
    free: { data: 'trains', note: 'Бесплатный план есть, но Mistral по умолчанию учится на запросах (отключается в панели). На платном плане не учится, логи 30 дней.' },
    pitch: 'Европейский сервис: около 21 цента за час, 13 языков с хорошим русским',
    models: [{ id: 'voxtral-mini-transcribe-latest', label: 'Voxtral Mini Transcribe', perMinute: 0.0035 }],
  },
  {
    id: 'siliconflow', label: 'SiliconFlow (Китай)', where: 'SiliconFlow (Китай, Сингапур)', base: 'https://api.siliconflow.com/v1', style: 'openai', keysUrl: 'https://cloud.siliconflow.com/account/ak',
    free: { data: 'unknown', note: 'Бесплатные модели есть, с лимитами. Условия по обучению на данных я не нашёл: считайте, что данные могут использоваться.' },
    pitch: 'Китайский сервис с бесплатными моделями распознавания: Qwen3-ASR знает больше 30 языков, SenseVoice лучше всего для китайского. Бесплатные модели имеют лимиты',
    models: [
      { id: 'Qwen/Qwen3-ASR-1.7B', label: 'Qwen3-ASR 1.7B (Alibaba)', perMinute: 0, note: 'Много языков, бесплатно' },
      { id: 'FunAudioLLM/SenseVoiceSmall', label: 'SenseVoice Small', perMinute: 0, note: 'Китайский, английский, японский, корейский' },
      { id: 'TeleAI/TeleSpeechASR', label: 'TeleSpeech ASR', perMinute: 0, note: 'Китайский и диалекты' },
    ],
  },
  {
    id: 'custom', label: 'Свой сервер', where: 'сервер, который указал владелец', base: '', style: 'openai', keysUrl: '',
    pitch: 'Любой сервис, понимающий запросы так же, как OpenAI: например, faster-whisper или whisper.cpp на вашем компьютере. Тогда запись не покидает вашу сеть',
    models: [{ id: 'whisper-1', label: 'Название модели на вашем сервере', perMinute: null }],
  },
]

export const sttPreset = (id: string) => STT_PRESETS.find((p) => p.id === id)
