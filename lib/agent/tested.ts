// What was actually run: a model is recommended only where it passed the assistant's own scenarios at that service.
// The same model reached through another service is not the same test, so nothing here is borrowed across services.
import type { PresetId } from './presets'

export interface Result { passed: number; of: number; date: string }

/** From docs/MODEL_BENCHMARK.md. Keyed by service and model id. */
export const TESTED: Record<string, Result> = {
  'openrouter:openai/gpt-6-luna': { passed: 93, of: 97, date: '2026-11-09' },
  'openrouter:deepseek/deepseek-v4.1-flash-1017': { passed: 95, of: 97, date: '2026-11-09' },
  'openrouter:minimax/minimax-m3.1-flash': { passed: 95, of: 97, date: '2026-11-09' },
  'openrouter:z-ai/glm-5.3-flash': { passed: 94, of: 97, date: '2026-11-09' },
  'openrouter:anthropic/claude-haiku-5.5': { passed: 93, of: 97, date: '2026-11-09' },
  'openrouter:qwen/qwen3.7-flash': { passed: 72, of: 97, date: '2026-11-09' },
}

export const resultFor = (service: PresetId, model: string) => TESTED[`${service}:${model}`] ?? null
/** Passing nearly everything: the bar for being recommended. */
export const recommended = (r: Result | null) => !!r && r.passed / r.of >= 0.9
