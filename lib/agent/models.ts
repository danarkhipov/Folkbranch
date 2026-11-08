// What a provider's own list says about its models. Nothing here is a list of names kept in the code:
// a model released next year shows up the day the provider lists it.
import type { PresetId } from './presets'

export interface LiveModel {
  id: string
  label: string
  /** Unix seconds, for newest first. */
  created: number
  /** Dollars per million tokens, in and out, when the provider says. */
  price: string | null
  /** True or false when the provider says whether the model takes pictures; null when its list is silent. */
  vision: boolean | null
  /** Whether the model can answer as a chat that calls tools, which the assistant needs. */
  usable: boolean
}

const rows = (b: any): any[] => (Array.isArray(b?.data) ? b.data : Array.isArray(b?.models) ? b.models : [])
const seconds = (v: unknown) => (typeof v === 'number' ? (v > 1e11 ? Math.floor(v / 1000) : v) : typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? Math.floor(Date.parse(v) / 1000) : 0)
const perMillion = (v: unknown) => { const n = Number(v) * 1e6; return Number.isFinite(n) ? String(+n.toPrecision(2)) : null }

// Kinds of model that are not a chat, by what the providers call them. Only used where a list says no more.
const NOT_CHAT = /embed|tts|transcribe|whisper|audio|realtime|image|moderation|dall|imagen|veo|sora|speech|rerank|live|robotics/i

/** One parser for each provider's list. An id the list gives is always kept, so a chosen model is always found. */
export const PARSERS: Record<PresetId, (body: any, folder: string) => LiveModel[]> = {
  openrouter: (b) => rows(b).map((m) => ({
    id: m.id, label: m.name ?? m.id, created: seconds(m.created),
    price: m.pricing ? `$${perMillion(m.pricing.prompt)} / $${perMillion(m.pricing.completion)}` : null,
    vision: Array.isArray(m.architecture?.input_modalities) ? m.architecture.input_modalities.includes('image') : null,
    usable: !!m.supported_parameters?.includes('tools') && (m.architecture?.output_modalities ?? ['text']).join() === 'text',
  })),
  anthropic: (b) => rows(b).map((m) => ({
    id: m.id, label: m.display_name ?? m.id, created: seconds(m.created_at), price: null,
    vision: typeof m.capabilities?.image_input?.supported === 'boolean' ? m.capabilities.image_input.supported : null,
    usable: true,
  })),
  moonshot: (b) => rows(b).map((m) => ({
    id: m.id, label: m.id, created: seconds(m.created), price: null,
    vision: typeof m.supports_image_in === 'boolean' ? m.supports_image_in : null,
    usable: true,
  })),
  google: (b) => rows(b).map((m) => {
    const id = String(m.name ?? m.id).replace(/^models\//, '')
    return { id, label: m.displayName ?? id, created: 0, price: null, vision: /^gemini/.test(id) && !NOT_CHAT.test(id) ? true : null, usable: (m.supportedGenerationMethods ?? ['generateContent']).includes('generateContent') && /^gemini/.test(id) && !NOT_CHAT.test(id) }
  }),
  openai: (b) => rows(b).map((m) => ({ id: m.id, label: m.id, created: seconds(m.created), price: null, vision: null, usable: /^(gpt-|o\d|chatgpt)/.test(m.id) && !NOT_CHAT.test(m.id) && !/search|codex|instruct/.test(m.id) })),
  // These lists carry nothing but ids: every one is offered, and whether it sees pictures is not claimed.
  deepseek: (b) => rows(b).map((m) => ({ id: m.id, label: m.id, created: seconds(m.created), price: null, vision: null, usable: !NOT_CHAT.test(m.id) })),
  cloudru: (b) => rows(b).map((m) => ({ id: m.id, label: m.id, created: seconds(m.created), price: null, vision: null, usable: !NOT_CHAT.test(m.id) })),
  yandex: (b, folder) => rows(b).filter((m) => String(m.id).startsWith('gpt://')).map((m) => {
    const id = String(m.id).replace(`gpt://${folder}/`, '')
    return { id, label: id.replace(/\/(latest|rc)$/, ''), created: 0, price: null, vision: null, usable: true }
  }),
}

/** Newest first; a model with no date goes after those with one. */
export const newestFirst = (list: LiveModel[]) => [...list].sort((a, b) => b.created - a.created || a.label.localeCompare(b.label))
