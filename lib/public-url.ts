/** The addresses people open the app at: the one set by hand first, then the one the platform gave. */
export function publicOrigins() {
  const { BETTER_AUTH_URL, RAILWAY_PUBLIC_DOMAIN } = process.env
  return [BETTER_AUTH_URL, RAILWAY_PUBLIC_DOMAIN && `https://${RAILWAY_PUBLIC_DOMAIN}`].filter((u): u is string => !!u).map((u) => u.replace(/\/+$/, ''))
}

export const publicUrl = () => publicOrigins()[0] ?? `http://localhost:${process.env.PORT || 3417}`
