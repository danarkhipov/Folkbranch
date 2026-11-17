import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { tokenActor } from '@/lib/api-auth'
import { buildMcpServer } from '@/lib/mcp'
import { recordUse } from '@/lib/ai/usage'

export const dynamic = 'force-dynamic'

async function handle(req: Request) {
  const actor = tokenActor(req.headers)
  if (!actor) return Response.json({ error: 'a valid API token is required' }, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } })
  if (Number(req.headers.get('content-length') ?? 0) > 60 * 1024 * 1024) return Response.json({ error: 'request too large' }, { status: 413 })
  // Stateless: nothing to keep between calls, and the host may sleep between them.
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await buildMcpServer(actor).connect(transport)
  const calls = await req.clone().json().then((b) => (Array.isArray(b) ? b : [b]).filter((m) => m?.method === 'tools/call').length).catch(() => 0)
  if (calls && actor.tokenId) recordUse('mcp', actor.tokenId, { requests: calls })
  return transport.handleRequest(req)
}

// Stateless means no stream to hold open and no session to end; an idle GET would otherwise hang.
const notHere = () => new Response(null, { status: 405, headers: { Allow: 'POST' } })

export { handle as POST, notHere as GET, notHere as DELETE }
