/** The bubble says a conversation, the star says it is with an AI. Works in any language. */
export function AssistantIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.5a8.5 8.5 0 0 1-12.3 7.6L3 21.5l1.4-5.2A8.5 8.5 0 1 1 21 12.5Z" />
      <path d="M12.5 8.2l.95 2.55 2.55.95-2.55.95-.95 2.55-.95-2.55-2.55-.95 2.55-.95Z" fill="currentColor" stroke="none" />
    </svg>
  )
}
