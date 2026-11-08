// Which AI answers: the owner's server settings choose, and the rest of the app does not care.
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { LanguageModel } from 'ai'

type ProviderId = 'anthropic' | 'openrouter' | 'openai' | 'google' | 'yandex' | 'cloudru' | 'deepseek' | 'moonshot' | 'local'
interface Provider {
  label: string
  keyEnv?: string
  /** Only where we can name one that exists, and always a cheap one: a strong model is the owner's choice, through AGENT_MODEL. */
  defaultModel?: string
  /** `folder` is only for Yandex, where the model's address names the account's folder. */
  create: (key: string, model: string, folder?: string) => LanguageModel
  /** Options sent with every request, and those that mark the fixed instructions for caching. */
  options?: Record<string, unknown>
  cached?: Record<string, unknown>
}

const PROVIDERS: Record<ProviderId, Provider> = {
  anthropic: {
    label: 'Anthropic', keyEnv: 'ANTHROPIC_API_KEY', defaultModel: 'claude-haiku-5-5',
    create: (apiKey, model) => createAnthropic({ apiKey })(model),
    options: { anthropic: { fallbacks: 'default' } },
    cached: { anthropic: { cacheControl: { type: 'ephemeral' } } },
  },
  openrouter: {
    label: 'OpenRouter', keyEnv: 'OPENROUTER_API_KEY', defaultModel: 'z-ai/glm-5.3-flash',
    // Family data: only routes that promise not to keep it for training, and of those the cheapest first.
    create: (apiKey, model) => createOpenRouter({ apiKey }).chat(model, { provider: { data_collection: 'deny', sort: 'price' }, ...(process.env.AGENT_REASONING === 'off' ? { reasoning: { effort: 'none' as const } } : {}), ...(model.startsWith('anthropic/') ? { cache_control: { type: 'ephemeral' as const } } : {}) }),
  },
  openai: { label: 'OpenAI', keyEnv: 'OPENAI_API_KEY', create: (apiKey, model) => createOpenAI({ apiKey })(model) },
  google: { label: 'Google', keyEnv: 'GOOGLE_GENERATIVE_AI_API_KEY', create: (apiKey, model) => createGoogleGenerativeAI({ apiKey })(model) },
  // Services that speak the OpenAI protocol under their own address, in Russia and China, where the big three are hard to pay for.
  yandex: {
    label: 'Yandex AI Studio', keyEnv: 'YANDEX_API_KEY', defaultModel: 'yandexgpt/latest',
    create: (apiKey, model, folder = '') => createOpenAICompatible({ name: 'yandex', baseURL: 'https://ai.api.cloud.yandex.net/v1', headers: { authorization: `Api-Key ${apiKey}`, 'openai-project': folder } })(`gpt://${folder}/${model}`),
  },
  cloudru: { label: 'Cloud.ru', keyEnv: 'CLOUDRU_API_KEY', defaultModel: 'Qwen/Qwen3.6-35B-A3B', create: (apiKey, model) => createOpenAICompatible({ name: 'cloudru', baseURL: 'https://foundation-models.api.cloud.ru/v1', apiKey })(model) },
  deepseek: { label: 'DeepSeek', keyEnv: 'DEEPSEEK_API_KEY', defaultModel: 'deepseek-flash', create: (apiKey, model) => createOpenAICompatible({ name: 'deepseek', baseURL: 'https://api.deepseek.com', apiKey })(model) },
  moonshot: { label: 'Moonshot (Kimi)', keyEnv: 'MOONSHOT_API_KEY', defaultModel: 'kimi-k2.6', create: (apiKey, model) => createOpenAICompatible({ name: 'moonshot', baseURL: 'https://api.moonshot.ai/v1', apiKey })(model) },
  // Ollama, LM Studio and the like: nothing leaves your server.
  local: { label: 'local model', create: (_key, model) => createOpenAICompatible({ name: 'local', baseURL: process.env.AGENT_BASE_URL ?? '', apiKey: process.env.AGENT_API_KEY })(model) },
}

export const keyEnvOf = (id: ProviderId) => PROVIDERS[id].keyEnv ?? ''

export interface ActiveProvider extends Provider { id: ProviderId; model: string; key: string; folder: string }

/** AGENT_PROVIDER decides; without it, the first provider with a key. Null when none can run. */
export function activeProvider(env: Record<string, string | undefined> = process.env): ActiveProvider | null {
  const named = env.AGENT_PROVIDER as ProviderId | undefined
  if (named && !PROVIDERS[named]) return null
  const id = named ?? (Object.keys(PROVIDERS) as ProviderId[]).find((p) => PROVIDERS[p].keyEnv && env[PROVIDERS[p].keyEnv!])
  if (!id) return null
  const p = PROVIDERS[id]
  const key = p.keyEnv ? env[p.keyEnv] : ''
  const model = env.AGENT_MODEL || p.defaultModel
  const folder = env.AGENT_FOLDER ?? ''
  if (!model || (p.keyEnv && !key) || (id === 'local' && !env.AGENT_BASE_URL) || (id === 'yandex' && !folder)) return null
  return { ...p, id, model, key: key ?? '', folder }
}
