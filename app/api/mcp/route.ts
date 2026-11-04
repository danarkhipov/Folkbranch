import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { tokenActor } from '@/lib/api-auth'
import { buildMcpServer } from '@/lib/mcp'

export const dynamic = 'force-dynamic'

async function handle(req: Request) {
  const actor = tokenActor(req.headers)
  if (!actor) return Response.json({ error: 'a valid API token is required' }, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } })
  // Stateless: nothing to keep between calls, and the host may sleep between them.
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await buildMcpServer(actor).connect(transport)
  return transport.handleRequest(req)
}

export { handle as GET, handle as POST, handle as DELETE }
