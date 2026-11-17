// The base map drawn off the page's thread: the files are read and parsed here, each level of detail is built here the
// first time a zoom needs it, and every view is drawn on a canvas of the worker's own and handed back as a picture.
// The page puts the picture in place in the same step as it moves the canvas, so a redraw never shows the old picture
// where the new one belongs.
import { ATLAS_FILES, atlasDrawer, type AtlasColours, type AtlasView, type Geometry } from './map-atlas-draw'

type In =
  | { type: 'init'; colours: AtlasColours }
  | { type: 'draw'; id: number; view: AtlasView; pw: number; ph: number }

const scope = self as unknown as { postMessage: (m: unknown, t?: Transferable[]) => void; onmessage: ((e: MessageEvent<In>) => void) | null }
let draw: ReturnType<typeof atlasDrawer> | null = null
let canvas: OffscreenCanvas | null = null

scope.onmessage = async (e) => {
  // A dedicated worker hears only the page that made it; this says so, and ignores a message from any other origin.
  if (e.origin && e.origin !== (self as unknown as { location: { origin: string } }).location.origin) return
  const { data } = e
  if (data.type === 'init') {
    try {
      // A proxy or an offline page can answer with HTML: anything but the files themselves is a failure, not a map.
      const files = await Promise.all(ATLAS_FILES.map((f) => fetch(`/atlas/${f}`).then((r) => { if (!r.ok) throw new Error(`${f}: ${r.status}`); return r.json() as Promise<Geometry> })))
      draw = atlasDrawer(files, data.colours)
      scope.postMessage({ type: 'ready' })
    } catch (e) {
      scope.postMessage({ type: 'error', error: (e as Error).message })
    }
    return
  }
  if (!draw) return
  const { id, view, pw, ph } = data
  if (!canvas || canvas.width !== pw || canvas.height !== ph) canvas = new OffscreenCanvas(pw, ph)
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, pw, ph)
  draw(ctx, view)
  const picture = canvas.transferToImageBitmap()
  scope.postMessage({ type: 'drawn', id, picture }, [picture])
}
