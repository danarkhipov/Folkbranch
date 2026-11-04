import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { tokenActor } from '@/lib/api-auth'
import { buildMcpServer } from '@/lib/mcp'

export const dynamic = 'force-dynamic'

async function handle(req: Request) {
  const actor = tokenActor(req.headers)
  if (!actor) return Response.json({ error: 'a valid API token is required' }, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } })
  if (Number(req.headers.get('content-length') ?? 0) > 60 * 1024 * 1024) return Response.json({ error: 'request too large' }, { status: 413 })
  // Stateless: nothing to keep between calls, and the host may sleep between them.
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await buildMcpServer(actor).connect(transport)
  return transport.handleRequest(req)
}

// Stateless means no stream to hold open and no session to end; an idle GET would otherwise hang.
const notHere = () => new Response(null, { status: 405, headers: { Allow: 'POST' } })

export { handle as POST, notHere as GET, notHere as DELETE }
