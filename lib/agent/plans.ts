import type { Plans } from './lines'
import type { PresetId } from './presets'

/** Said plainly, for the page that chooses a service. A service missing here is shown without a claim about its free plan. */
export const ASSISTANT_PLANS: Partial<Record<PresetId, Plans>> = {
  openrouter: { free: { data: 'mixed', note: 'Есть несколько бесплатных моделей, но часть может использовать ваши тексты.' }, paid: 'Платно, ваши тексты не используются' },
  anthropic: { free: null, paid: 'Только платно, ваши тексты не используются' },
  openai: { free: null, paid: 'Только платно, ваши тексты не используются' },
  google: { free: { data: 'trains', note: 'Бесплатно для лёгких моделей, но Google использует ваши тексты.' }, paid: 'Платно, ваши тексты не используются' },
}
