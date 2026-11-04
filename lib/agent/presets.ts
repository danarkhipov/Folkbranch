// The providers a person can connect from the app. Plain data, so the browser can show them too.
export type PresetId = 'openrouter' | 'anthropic' | 'openai' | 'google'

export interface Preset {
  id: PresetId
  label: string
  /** Where the key is made. */
  keysUrl: string
  pitch: string
  /** What the second step means at this provider. */
  howTo: string
  /** The first is the default: cheap and fast. Anything dearer is only ever the person's own choice. */
  models: PresetModel[]
}

/** Prices are per million tokens as listed on OpenRouter in November 2026, as a guide: they vary by route and change often. */
export interface PresetModel { id: string; label: string; price: string; note?: string }

export const PRESETS: Preset[] = [
  { id: 'openrouter', label: 'OpenRouter', keysUrl: 'https://openrouter.ai/settings/keys', pitch: 'Один ключ ко многим моделям. Проще всего начать отсюда', howTo: 'Войдите, нажмите «Create API key» и пополните счёт на странице Credits', models: [{ id: 'z-ai/glm-5.3-flash', label: 'GLM-5.3 Flash', price: '$0.03–0.15 / $0.10–0.50', note: 'Самая дешёвая' }, { id: 'deepseek/deepseek-v4.1-flash-1017', label: 'DeepSeek V4.1 Flash', price: '$0.15 / $0.60', note: 'Лучше всего для длинных разговоров: повторы почти бесплатны' }, { id: 'qwen/qwen3.7-flash', label: 'Qwen 3.7 Flash', price: '$0.03 / $0.13', note: 'Очень дешёвая' }, { id: 'minimax/minimax-m3.1-flash', label: 'MiniMax M3.1 Flash', price: '$0.075 / $0.30' }, { id: 'openai/gpt-6-luna', label: 'GPT-6 Luna', price: '$0.10 / $0.50' }, { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5', price: '$0.10 / $0.50' }] },
  { id: 'anthropic', label: 'Anthropic (Claude)', keysUrl: 'https://platform.claude.com/settings/keys', pitch: 'Модели Claude напрямую', howTo: 'Войдите, нажмите «Create Key» и пополните счёт в разделе Billing. Подписка Claude здесь не подходит', models: [{ id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', price: '$0.10 / $0.50' }, { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', price: '$2 / $10', note: 'В 20 раз дороже' }] },
  { id: 'openai', label: 'OpenAI (ChatGPT)', keysUrl: 'https://platform.openai.com/api-keys', pitch: 'Модели OpenAI напрямую', howTo: 'Войдите, нажмите «Create new secret key» и пополните счёт в разделе Billing. Подписка ChatGPT здесь не подходит', models: [{ id: 'gpt-6-luna', label: 'GPT-6 Luna', price: '$0.10 / $0.50' }, { id: 'gpt-6-luna-pro', label: 'GPT-6 Luna Pro', price: '$0.10 / $0.50' }] },
  { id: 'google', label: 'Google (Gemini)', keysUrl: 'https://aistudio.google.com/app/apikey', pitch: 'Модели Gemini напрямую', howTo: 'Войдите и нажмите «Create API key»', models: [{ id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', price: '$0.25 / $1.50' }, { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite', price: '$0.30 / $2.50' }] },
]
