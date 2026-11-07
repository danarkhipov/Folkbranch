import { findGaps } from '@/lib/ops/gaps'
import * as gedcom from '@/lib/ops/gedcom'
import { previewCase } from '@/lib/ops/kinship-case'
import * as people from '@/lib/ops/people'
import { dispatch } from '@/lib/ops/proposals'
import { OPS } from '@/lib/ops/registry'
import * as settings from '@/lib/ops/settings'
import { parseFamilyText, planFamilyText, serializeFamilyText } from '@/lib/textformat'
import { get, human, op, type Route } from '../router'

export const exchangeRoutes: Route[] = [
  get('gaps', 'What is unfinished, person by person', ({ actor }) => findGaps(actor, { limit: 200 }).map(({ person, ...r }) => ({ id: person.id, ...r }))),
  get('history', 'Recent changes', ({ actor, query }) => settings.listHistory(actor, Math.min(Number(query.get('limit')) || 100, 500))),
  get('persons/:id/history', 'What was changed about one person, by whom and when', ({ actor, params }) => settings.listHistory(actor, 100, params.id)),
  op('POST', 'history/:id/undo', 'undo', ({ params }) => ({ historyId: params.id })),

  get('text/export', 'The graph in the text format', ({ actor }) => new Response(serializeFamilyText(people.getGraph(actor), settings.getSetting('familyName') ?? ''), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })),
  { method: 'POST', path: 'text/preview', summary: 'What a text import would do, changing nothing', handler: async ({ actor, body }) => {
    const b = OPS.import_text.input.parse(await body()) as { text: string; resolutions?: Record<string, string> }
    const { ops, ...plan } = planFamilyText(parseFamilyText(b.text), people.getGraph(actor), b.resolutions)
    return { ...plan, operations: ops.length }
  } },
  op('POST', 'text/import', 'import_text'),

  human('POST', 'case/preview', 'Count what a kinship research case holds', async ({ actor, req }) => previewCase(actor, await req.json())),
  op('POST', 'case/import', 'import_kinship_case'),

  human('POST', 'gedcom/preview', 'Count what a GEDCOM file holds', async ({ actor, req }) => gedcom.previewGedcom(actor, await req.text())),
  { method: 'POST', path: 'gedcom/import', summary: OPS.import_gedcom.description, op: 'import_gedcom', handler: async ({ actor, req }) => dispatch(actor, 'import_gedcom', { text: await req.text() }) },
  get('gedcom/export', 'The graph as GEDCOM; living=hide hides the living', ({ actor, query }) =>
    new Response(gedcom.exportGedcom(actor, query.get('living') === 'hide'), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': 'attachment; filename="family.ged"' } })),
]
