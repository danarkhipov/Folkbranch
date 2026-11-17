import type { EventKind } from './map-timeline'

/** One quiet glyph per kind of event, in the map's ink: on the map's marks and in its key. */
export const GLYPH: Record<EventKind, string> = { birth: '*', death: '†', union: '∞', move: '⌂', work: '✎', other: '·' }
