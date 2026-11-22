// The chronicle: what was going on around the family. Agents write it straight, with an editor token or a session;
// everyone reads it through the one filter in lib/ops/chronicle.ts.
import * as chronicle from '@/lib/ops/chronicle'
import { human, open, type Route } from '../router'

export const chronicleRoutes: Route[] = [
  open('chronicle', 'What was going on around the family, without the shapes', ({ actor }) => chronicle.listChronicle(actor)),
  // Before the list: a page asks for the entries only when one of the owner's switches shows them.
  open('chronicle/switches', 'Whether the map shows the history (shapes) and the chronicle (words), for this caller', ({ actor }) => chronicle.getSwitches(actor)),
  open('chronicle/:key/shape', "One entry's shape on the map: zones, a route or places", ({ actor, params }) => chronicle.shapeFor(actor, params.key)),
  // Not through the review queue: an entry is not a fact about a person, and it is not in the history (as saved views).
  { method: 'PUT', path: 'chronicle/:key', summary: 'Create or replace a chronicle entry', handler: async ({ actor, params, body }) => chronicle.putEntry(actor, params.key, await body()) },
  { method: 'DELETE', path: 'chronicle/:key', summary: 'Remove a chronicle entry', handler: ({ actor, params }) => chronicle.deleteEntry(actor, params.key) },
  human('PUT', 'chronicle', 'The owner\'s switches: history on the map, the chronicle, and who sees them', async ({ actor, body }) => chronicle.setSwitches(actor, await body())),
]
