import { Sparkle } from 'lucide-react'

/** One star: said to mean AI by now, and as quiet as the icons beside it. */
export function AssistantIcon({ size = 16 }: { size?: number }) {
  return <Sparkle size={size} strokeWidth={2} className="flex-none" aria-hidden="true" />
}
