// Cloud faces: the owner connects one face service and pays for it; every editor can then find and recognise faces
// through this server, which keeps the key, forwards the photo and keeps nothing of it. Nothing here runs unless the owner set it up.
import { monthTotal, recordUse } from '../ai/usage'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { z } from 'zod'
import { type Actor, OpError, requireRole } from '../ops/core'
import { getSetting, tell, setSetting } from '../ops/settings'
import { seal, unseal } from '../sealed'
import { FACE_PRESETS, faceChoices, facePreset, type FaceBox, type FaceId, type FaceMatch, type FaceSize } from './presets'
import { refuseInDemo } from '../demo-mode'

const purpose = 'face-key'
const MAX_BYTES = 10 * 1024 * 1024
const MAX_REFERENCES = 12
const DEFAULT_LIMIT_REQUESTS = 1000
const month = () => new Date().toISOString().slice(0, 7)

interface Config { provider: FaceId; baseUrl?: string; key: string; secret?: string; limitRequests: number }

function fromApp(): Config | null {
  const sealed = getSetting('faceConfig')
  const text = sealed ? unseal(sealed, purpose) : null
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as Config
    return facePreset(parsed.provider) ? parsed : null
  } catch {
    return null
  }
}

function fromEnv(): Config | null {
  const provider = process.env.FACE_PROVIDER as FaceId | undefined
  const preset = provider && facePreset(provider)
  const key = process.env.FACE_API_KEY?.trim()
  if (!preset || !key) return null
  const secret = process.env.FACE_API_SECRET?.trim()
  if (preset.needsSecret && !secret) return null
  return {
    provider: preset.id,
    baseUrl: process.env.FACE_BASE_URL?.trim() || undefined,
    key,
    secret,
    limitRequests: Number(process.env.FACE_LIMIT_REQUESTS ?? DEFAULT_LIMIT_REQUESTS),
  }
}

/** The setup that answers now: the server's environment first, so an admin's choice always wins. */
function config() {
  const cfg = fromEnv() ?? fromApp()
  if (!cfg) return null
  const preset = facePreset(cfg.provider)!
  const base = (cfg.baseUrl || preset.base).replace(/\/+$/, '')
  if (!base || (preset.needsSecret && !cfg.secret)) return null
  return { cfg, preset, base, key: cfg.key, secret: cfg.secret }
}

/** The cloud face setup without its keys, for the settings file. */
export function faceSetup() {
  const c = config()
  return c && { provider: c.cfg.provider, baseUrl: c.cfg.baseUrl ?? null, limitRequests: c.cfg.limitRequests, fromServer: !!fromEnv() }
}

function addUsage(calls: number, perCall: number | null, userId: string) {
  if (!calls) return
  const free = perCall === 0
  recordUse('faces', userId, { requests: calls, dollars: free ? 0 : null })
}

/** What any signed-in editor may know: whether it works and where a photo goes. */
export function facesInfo() {
  const c = config()
  return {
    enabled: !!c,
    provider: c?.preset.id ?? null,
    label: c?.preset.label ?? null,
    where: c?.preset.where ?? null,
    keeps: c?.preset.keeps ?? null,
    threshold: c?.preset.threshold ?? null,
  }
}

/** For the owner: what is set, and what this month has cost. The keys themselves never leave. */
export function facesStatus(actor: Actor) {
  requireRole(actor, 'owner')
  const c = config()
  const usage = monthTotal('faces')
  return {
    presets: faceChoices(),
    current: c && {
      provider: c.cfg.provider,
      baseUrl: c.cfg.baseUrl ?? null,
      source: fromEnv() ? 'server' as const : 'app' as const,
      keyEnding: c.key.slice(-4),
      secretEnding: c.secret ? c.secret.slice(-4) : null,
      limitRequests: c.cfg.limitRequests,
    },
    usage: { month: month(), requests: usage.requests, dollars: usage.dollars, unpriced: usage.unpriced },
  }
}

const input = z.object({
  provider: z.enum(FACE_PRESETS.map((p) => p.id) as [FaceId, ...FaceId[]]),
  baseUrl: z.string().trim().url().max(300).optional(),
  key: z.string().trim().max(400).optional(),
  secret: z.string().trim().max(400).optional(),
  limitRequests: z.number().int().min(0).max(1_000_000).optional(),
})

async function ask(url: string, init: RequestInit, timeout = 30_000) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) }).catch(() => null)
  if (!res) throw new OpError(502, tell('Could not reach the service. Check the address and the server\'s internet'))
  return res
}

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex')
const hmac = (key: string | Buffer, s: string) => createHmac('sha256', key).update(s).digest()

/** AWS asks for a signed request; signing is local and costs nothing. */
function aws(c: { base: string; key: string; secret?: string }, method: string, target: string, body: string) {
  const url = new URL(c.base)
  const region = /rekognition\.([^.]+)\.amazonaws\.com$/.exec(url.host)?.[1] ?? 'us-east-1'
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const day = amzDate.slice(0, 8)
  const contentType = 'application/x-amz-json-1.1'
  const canonicalHeaders = `content-type:${contentType}\nhost:${url.host}\nx-amz-date:${amzDate}\nx-amz-target:${target}\n`
  const signedHeaders = 'content-type;host;x-amz-date;x-amz-target'
  const canonicalRequest = [method, url.pathname || '/', url.search.slice(1), canonicalHeaders, signedHeaders, sha256(body)].join('\n')
  const scope = `${day}/${region}/rekognition/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n')
  const key = hmac(hmac(hmac(hmac(`AWS4${c.secret}`, day), region), 'rekognition'), 'aws4_request')
  const final = createHmac('sha256', key).update(stringToSign).digest('hex')
  return {
    'content-type': contentType,
    'x-amz-date': amzDate,
    'x-amz-target': target,
    authorization: `AWS4-HMAC-SHA256 Credential=${c.key}/${scope}, SignedHeaders=${signedHeaders}, Signature=${final}`,
  }
}

function refused(res: Response): never {
  if (res.status === 401 || res.status === 403) throw new OpError(502, tell('The service did not accept the owner\'s key. Tell them'))
  if (res.status === 402) throw new OpError(502, tell('The service account is out of money. Tell the owner'))
  if (res.status === 413) throw new OpError(413, tell('The photo is too large for the service'))
  if (res.status === 429) throw new OpError(429, tell('The service asks you to wait. Try again in a minute'))
  throw new OpError(502, `${tell('The service answered with an error')}: ${res.status}`)
}

const blob = (bytes: Buffer, mime = 'image/jpeg') => new Blob([new Uint8Array(bytes)], { type: mime })

async function detect(c: NonNullable<ReturnType<typeof config>>, bytes: Buffer, size: FaceSize, mime = 'image/jpeg'): Promise<FaceBox[]> {
  let res: Response
  if (c.preset.style === 'rekognition') {
    const body = JSON.stringify({ Image: { Bytes: bytes.toString('base64') } })
    res = await ask(`${c.base}/`, { method: 'POST', headers: aws(c, 'POST', 'RekognitionService.DetectFaces', body), body })
  } else if (c.preset.style === 'facepp') {
    const form = new FormData()
    form.set('api_key', c.key)
    form.set('api_secret', c.secret ?? '')
    form.set('image_base64', bytes.toString('base64'))
    form.set('return_landmark', '0')
    res = await ask(`${c.base}/facepp/v3/detect`, { method: 'POST', body: form })
  } else if (c.preset.style === 'luxand') {
    const form = new FormData()
    form.set('photo', blob(bytes, mime), 'photo.jpg')
    res = await ask(`${c.base}/photo/detect`, { method: 'POST', headers: { token: c.key }, body: form })
  } else {
    const form = new FormData()
    form.set('file', blob(bytes, mime), 'photo.jpg')
    res = await ask(`${c.base}/api/v1/detection/detect?face_plugins=calculator`, { method: 'POST', headers: { 'x-api-key': c.key }, body: form })
  }
  if (!res.ok) refused(res)
  const body = await res.json().catch(() => null)
  if (!body) throw new OpError(502, tell('The service\'s reply made no sense'))
  return c.preset.parseDetect(body, size)
}

async function compare(c: NonNullable<ReturnType<typeof config>>, reference: Buffer, target: Buffer, size: FaceSize, targetFaces: FaceBox[], mime = 'image/jpeg'): Promise<FaceMatch | null> {
  if (c.preset.style === 'rekognition') {
    const body = JSON.stringify({ SourceImage: { Bytes: reference.toString('base64') }, TargetImage: { Bytes: target.toString('base64') }, SimilarityThreshold: 0 })
    const res = await ask(`${c.base}/`, { method: 'POST', headers: aws(c, 'POST', 'RekognitionService.CompareFaces', body), body })
    if (!res.ok) refused(res)
    const parsed = await res.json().catch(() => null)
    return parsed ? c.preset.parseCompare(parsed, size) : null
  }
  if (c.preset.style === 'facepp') {
    const form = new FormData()
    form.set('api_key', c.key)
    form.set('api_secret', c.secret ?? '')
    form.set('image_base64_1', reference.toString('base64'))
    form.set('image_base64_2', target.toString('base64'))
    const res = await ask(`${c.base}/facepp/v3/compare`, { method: 'POST', body: form })
    if (!res.ok) refused(res)
    const parsed = await res.json().catch(() => null)
    return parsed ? c.preset.parseCompare(parsed, size) : null
  }
  if (c.preset.style === 'luxand') {
    // Luxand compares against a stored person, so the reference lives there for one request and is removed at once.
    const name = `folkbranch-${randomUUID()}`
    const create = new FormData()
    create.set('name', name)
    create.set('photos', blob(reference, mime), 'reference.jpg')
    create.set('store', '1')
    const made = await ask(`${c.base}/v2/person`, { method: 'POST', headers: { token: c.key }, body: create })
    if (!made.ok) refused(made)
    const uuid = (await made.json().catch(() => null))?.uuid as string | undefined
    if (!uuid) return null
    try {
      const form = new FormData()
      form.set('photo', blob(target, mime), 'photo.jpg')
      const res = await ask(`${c.base}/photo/verify/${encodeURIComponent(uuid)}`, { method: 'POST', headers: { token: c.key }, body: form })
      if (!res.ok) refused(res)
      const parsed = await res.json().catch(() => null)
      const match = parsed ? c.preset.parseCompare(parsed, size) : null
      return match ? { ...match, ...(targetFaces.length === 1 ? { box: targetFaces[0] } : {}) } : null
    } finally {
      await fetch(`${c.base}/v2/person/${encodeURIComponent(uuid)}`, { method: 'DELETE', headers: { token: c.key } }).catch(() => null)
    }
  }
  // CompreFace returns a face vector with every face; two vectors are compared here, so nothing is stored.
  const referenceFaces = await detect(c, reference, size, mime)
  const from = referenceFaces[0]?.embedding
  if (!from) return null
  let best: FaceMatch | null = null
  for (const face of targetFaces) {
    if (!face.embedding) continue
    const score = cosine(from, face.embedding)
    if (!best || score > best.score) best = { score, box: face }
  }
  return best
}

function cosine(a: number[], b: number[]) {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return na && nb ? Math.min(1, Math.max(0, dot / Math.sqrt(na * nb))) : 0
}

/** A check that costs nothing: each service has a read-only endpoint that still proves the key. */
async function checkKey(c: NonNullable<ReturnType<typeof config>>) {
  let res: Response
  if (c.preset.style === 'rekognition') {
    const body = JSON.stringify({ MaxResults: 1 })
    res = await ask(`${c.base}/`, { method: 'POST', headers: aws(c, 'POST', 'RekognitionService.ListCollections', body), body })
  } else if (c.preset.style === 'facepp') {
    const form = new FormData()
    form.set('api_key', c.key)
    form.set('api_secret', c.secret ?? '')
    res = await ask(`${c.base}/facepp/v3/faceset/getfacesets`, { method: 'POST', body: form })
  } else if (c.preset.style === 'luxand') {
    res = await ask(`${c.base}/v2/person`, { method: 'GET', headers: { token: c.key } })
  } else {
    // A CompreFace detection key is separate from the recognition key, so the check uses the service it will call.
    const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } }).jpeg().toBuffer()
    const form = new FormData()
    form.set('file', blob(bytes), 'photo.jpg')
    res = await ask(`${c.base}/api/v1/detection/detect`, { method: 'POST', headers: { 'x-api-key': c.key }, body: form })
  }
  // AWS answers a wrong key with 400 and the reason in __type, not with 401.
  const awsBody = c.preset.style === 'rekognition' && res.status === 400 ? await res.clone().text().catch(() => '') : ''
  if (/AccessDenied/.test(awsBody)) throw new OpError(400, tell('The key is right, but it has no rights to Amazon Rekognition. Give the IAM user access to Rekognition'))
  const awsRefused = /UnrecognizedClient|InvalidSignature|SignatureDoesNotMatch|MissingAuthentication|InvalidClientTokenId|AuthFailure|ExpiredToken/.test(awsBody)
  if (res.status === 401 || res.status === 403 || awsRefused) throw new OpError(400, tell('The service did not accept this key. Check that it was copied whole'))
  if (res.status === 429) throw new OpError(429, tell('The service asks you to wait. Try again in a minute'))
  if (!res.ok) throw new OpError(502, `${tell('The service answered with an error')}: ${res.status}`)
}

export async function saveFaces(actor: Actor, raw: unknown) {
  refuseInDemo()
  requireRole(actor, 'owner')
  if (fromEnv()) throw new OpError(409, tell('Cloud faces are set in the server settings'))
  const b = input.parse(raw)
  const preset = facePreset(b.provider)!
  const old = fromApp()
  if (preset.needsBase && !b.baseUrl && !(old?.provider === preset.id && old.baseUrl)) throw new OpError(400, tell('Enter the CompreFace server address'))
  const key = b.key || (old?.provider === b.provider ? old.key : undefined)
  const secret = b.secret || (old?.provider === b.provider ? old.secret : undefined)
  if (!key) throw new OpError(400, tell('Paste the service key'))
  if (preset.needsSecret && !secret) throw new OpError(400, tell('Paste the service secret'))
  const cfg: Config = {
    provider: preset.id,
    baseUrl: b.baseUrl || (old?.provider === preset.id ? old.baseUrl : undefined),
    key,
    secret,
    limitRequests: b.limitRequests ?? old?.limitRequests ?? DEFAULT_LIMIT_REQUESTS,
  }
  const candidate = { cfg, preset, base: (cfg.baseUrl || preset.base).replace(/\/+$/, ''), key, secret }
  await checkKey(candidate)
  setSetting('faceConfig', seal(JSON.stringify(cfg), purpose))
  return facesStatus(actor)
}

export function removeFaces(actor: Actor) {
  refuseInDemo()
  requireRole(actor, 'owner')
  if (fromEnv()) throw new OpError(409, tell('Cloud faces are set in the server settings'))
  setSetting('faceConfig', '')
  return facesStatus(actor)
}

const size = z.object({ width: z.number().int().min(1).max(20_000), height: z.number().int().min(1).max(20_000) })
const picture = size.extend({ data: z.string().min(1) })
const scanInput = z.object({
  photo: picture,
  references: z.array(z.object({ personId: z.string().min(1).max(80), photo: picture })).max(MAX_REFERENCES),
})

function decode(p: z.infer<typeof picture>) {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(p.data)
  if (!m) throw new OpError(400, tell('The photo arrived in an unknown form'))
  const bytes = Buffer.from(m[2], 'base64')
  if (!bytes.length) throw new OpError(400, tell('The photo is empty'))
  if (bytes.length > MAX_BYTES) throw new OpError(413, tell('The photo is too large: up to 10 MB'))
  return { bytes, mime: m[1], size: { width: p.width, height: p.height } }
}

// A few scans a minute from one person is plenty; more is a stuck button or someone testing the owner's wallet.
const recent = new Map<string, number[]>()
function slowDown(userId: string, kind: string, limit: number) {
  const key = `${kind}:${userId}`
  const now = Date.now()
  const list = (recent.get(key) ?? []).filter((t) => now - t < 60_000)
  if (list.length >= limit) throw new OpError(429, tell('Too many requests in a row. Wait a minute'))
  recent.set(key, [...list, now])
}

function checkLimit(c: NonNullable<ReturnType<typeof config>>, calls: number) {
  const cap = c.cfg.limitRequests
  const used = monthTotal('faces').requests
  if (cap > 0 && used + calls > cap) throw new OpError(429, tell('This month\'s face recognition limit set by the owner is used up'))
}

/** One photo and a few already-tagged faces: the service finds every face, and says which known person each may be. */
export async function scanFaces(actor: Actor, raw: unknown) {
  refuseInDemo()
  requireRole(actor, 'editor')
  const c = config()
  if (!c) throw new OpError(409, tell('Cloud face recognition is not set up'))
  const b = scanInput.parse(raw)
  const photo = decode(b.photo)
  const references = b.references.map((r) => ({ personId: r.personId, ...decode(r.photo) }))
  const estimated = 1 + references.length * (c.preset.style === 'luxand' ? 3 : 1)
  checkLimit(c, estimated)
  slowDown(actor.userId, 'faces', 6)
  let spent = 0
  try {
    const faces = await detect(c, photo.bytes, photo.size, photo.mime)
    spent++
    const matches: { personId: string; score: number; box: FaceBox | null }[] = []
    for (const reference of references) {
      spent += c.preset.style === 'luxand' ? 3 : 1
      const found = await compare(c, reference.bytes, photo.bytes, photo.size, faces, reference.mime)
      if (found && found.score >= c.preset.threshold) matches.push({ personId: reference.personId, score: Math.round(found.score * 1000) / 1000, box: found.box ?? (faces.length === 1 ? faces[0] : null) })
    }
    return { provider: c.preset.id, threshold: c.preset.threshold, faces, matches }
  } finally {
    addUsage(spent, c.preset.perCall, actor.userId)
  }
}

/** A blank picture is enough to see that the key, the address and the service work together. */
export async function testFaces(actor: Actor) {
  refuseInDemo()
  requireRole(actor, 'owner')
  const c = config()
  if (!c) throw new OpError(409, tell('Connect a service first'))
  checkLimit(c, 1)
  const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } }).jpeg().toBuffer()
  await detect(c, bytes, { width: 64, height: 64 })
  addUsage(1, c.preset.perCall, actor.userId)
  return { ok: true }
}
