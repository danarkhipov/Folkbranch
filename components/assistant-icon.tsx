import { Sparkles } from 'lucide-react'

/** Sparkles are what most people now read as AI. */
export function AssistantIcon({ size = 20 }: { size?: number }) {
  return <Sparkles size={size} strokeWidth={2} className="flex-none" aria-hidden="true" />
}
