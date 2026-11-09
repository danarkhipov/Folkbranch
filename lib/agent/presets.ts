// The providers a person can connect from the app. Plain data, so the browser can show them too.
export type PresetId = 'openrouter' | 'anthropic' | 'openai' | 'google' | 'yandex' | 'cloudru' | 'deepseek' | 'moonshot'

export interface Preset {
  id: PresetId
  label: string
  /** Its logo in components/brand-icons.tsx. */
  icon?: 'openrouter' | 'anthropic' | 'openai' | 'gemini' | 'yandex' | 'deepseek'
  /** Where the service is based, for the list's grouping. */
  region: 'world' | 'ru' | 'cn'
  /** The key alone is not enough: the service also wants the account's folder. */
  folder?: boolean
  /** Where the key is made. */
  keysUrl: string
  pitch: string
  /** What the second step means at this provider. */
  howTo: string
  /** The first is the default: cheap and fast. Anything dearer is only ever the person's own choice. */
  models: PresetModel[]
}

/** Prices are per million tokens as listed by each service in November 2026 (dollars, or roubles at the Russian ones), as a guide: they change often. */
export interface PresetModel { id: string; label: string; price: string; note?: string }

export const PRESETS: Preset[] = [
  { id: 'openrouter', region: 'world', icon: 'openrouter', label: 'OpenRouter', keysUrl: 'https://openrouter.ai/settings/keys', pitch: 'Проще всего начать отсюда: один ключ подходит к разным нейросетям', howTo: 'Войдите, нажмите «Create API key» и пополните счёт на странице «Credits»', models: [{ id: 'openai/gpt-6-luna', label: 'GPT-6 Luna', price: '$0.10 / $0.50', note: 'Проверена: 93 из 97 сценариев, около 6 центов на все. OpenAI не учится на запросах' }, { id: 'deepseek/deepseek-v4.1-flash-1017', label: 'DeepSeek V4.1 Flash', price: '$0.15 / $0.60', note: 'Проверена: 95 из 97, самая дешёвая из лучших. Хост DeepSeek может учиться на запросах' }, { id: 'minimax/minimax-m3.1-flash', label: 'MiniMax M3.1 Flash', price: '$0.075 / $0.30', note: 'Проверена: 95 из 97' }, { id: 'z-ai/glm-5.3-flash', label: 'GLM-5.3 Flash', price: '$0.03–0.15 / $0.10–0.50', note: 'Проверена: 94 из 97, но иногда думает минуту-две' }, { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5', price: '$0.10 / $0.50', note: 'Проверена: 93 из 97' }] },
{ id: 'anthropic', region: 'world', icon: 'anthropic', label: 'Anthropic (Claude)', keysUrl: 'https://platform.claude.com/settings/keys', pitch: '', howTo: 'Войдите, нажмите «Create Key» и пополните счёт в разделе «Billing». Подписка Claude здесь не подходит', models: [{ id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', price: '$0.10 / $0.50' }, { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', price: '$2 / $10', note: 'В 20 раз дороже' }] },
  { id: 'openai', region: 'world', icon: 'openai', label: 'OpenAI (ChatGPT)', keysUrl: 'https://platform.openai.com/api-keys', pitch: '', howTo: 'Войдите, нажмите «Create new secret key» и пополните счёт в разделе «Billing». Подписка ChatGPT здесь не подходит', models: [{ id: 'gpt-6-luna', label: 'GPT-6 Luna', price: '$0.10 / $0.50' }, { id: 'gpt-6-luna-pro', label: 'GPT-6 Luna Pro', price: '$0.10 / $0.50' }] },
  { id: 'google', region: 'world', icon: 'gemini', label: 'Google (Gemini)', keysUrl: 'https://aistudio.google.com/app/apikey', pitch: '', howTo: 'Войдите и нажмите «Create API key»', models: [{ id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite', price: '$0.30 / $2.50' }, { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', price: '$0.75 / $3.75', note: 'Сильнее, но в 2,5 раза дороже' }] },
  { id: 'yandex', region: 'ru', icon: 'yandex', label: 'Yandex AI Studio', keysUrl: 'https://aistudio.yandex.cloud/platform/', pitch: 'Российский сервис: оплата в рублях, серверы в России', howTo: 'Войдите, нажмите «Создать API-ключ» и скопируйте ключ. Идентификатор каталога виден в консоли Yandex Cloud рядом с названием каталога', folder: true, models: [{ id: 'yandexgpt/latest', label: 'YandexGPT', price: 'в рублях, см. тарифы Яндекса' }, { id: 'aliceai-llm/latest', label: 'Алиса AI', price: 'в рублях, см. тарифы Яндекса' }] },
  { id: 'cloudru', region: 'ru', label: 'Cloud.ru (GigaChat, Qwen и другие)', keysUrl: 'https://console.cloud.ru/', pitch: 'Российский сервис: оплата в рублях, здесь же модели GigaChat от Сбера', howTo: 'В консоли откройте сервис Foundation Models, создайте API-ключ и скопируйте его', models: [{ id: 'Qwen/Qwen3.6-35B-A3B', label: 'Qwen 3.6 35B', price: '220 ₽ / 330 ₽', note: 'Видит картинки' }, { id: 'GigaChat/GigaChat-3-Pro', label: 'GigaChat 3 Pro', price: '73 ₽ / 176 ₽' }, { id: 'ai-sage/GigaChat3.5-432B-A28B-Reasoning', label: 'GigaChat 3.5 432B', price: '96 ₽ / 289 ₽', note: 'Самая сильная модель Сбера' }] },
  { id: 'deepseek', region: 'cn', icon: 'deepseek', label: 'DeepSeek', keysUrl: 'https://platform.deepseek.com/api_keys', pitch: 'Китайский сервис с низкими ценами', howTo: 'Войдите, нажмите «Create new API key» и пополните баланс', models: [{ id: 'deepseek-flash', label: 'DeepSeek V4.1 Flash', price: '$0.15–0.30 / $0.60–1.20', note: 'Ночью и в выходные вдвое дешевле' }] },
  { id: 'moonshot', region: 'cn', label: 'Moonshot (Kimi)', keysUrl: 'https://platform.kimi.ai/console/api-keys', pitch: 'Китайский сервис. Ключ международной платформы, не китайской', howTo: 'Войдите, пополните счёт минимум на $1 и нажмите «Create API key»', models: [{ id: 'kimi-k3.1-pro', label: 'Kimi K3.1 Pro', price: '$2 / $10' }] },
]
