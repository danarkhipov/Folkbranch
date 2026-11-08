import type { Plans } from './lines'
import type { PresetId } from './presets'

/** Said plainly, for the page that chooses a service. A service missing here is shown without a claim about its free plan. */
export const ASSISTANT_PLANS: Partial<Record<PresetId, Plans>> = {
  openrouter: { free: { data: 'mixed', note: 'Есть несколько бесплатных моделей: до 50 запросов в день. Часть из них работает на хостах, которые могут учиться на запросах.' }, paid: 'Платно: цена за каждую модель видна на странице модели, данные по умолчанию не хранятся и не используются' },
  anthropic: { free: null, paid: 'Только платно. По условиям Anthropic запросы через API не используются для обучения' },
  openai: { free: null, paid: 'Только платно. По условиям OpenAI запросы через API не используются для обучения' },
  google: { free: { data: 'trains', note: 'Бесплатный план есть для лёгких моделей. Google использует запросы для развития продуктов, а текст могут читать люди. Для семейных записей лучше платный.' }, paid: 'Платно: данные не используются для обучения, логи хранятся ограниченное время' },
}
