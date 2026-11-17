// Cloud faces: one service for the whole archive, the owner's key and bill, editors use it, nothing is kept.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { facesInfo, facesStatus, removeFaces, saveFaces, scanFaces, testFaces } from '../lib/faces/service'
import { setSetting } from '../lib/ops/settings'
import { editor, owner, reader } from './fixture-family'

const env = ['FACE_PROVIDER', 'FACE_API_KEY', 'FACE_API_SECRET', 'FACE_BASE_URL', 'FACE_LIMIT_REQUESTS']
const keep: Record<string, string | undefined> = {}
const month = () => new Date().toISOString().slice(0, 7)
const image = (byte = 'AA') => ({ data: `data:image/jpeg;base64,${byte}`, width: 1000, height: 1000 })
const calls: { url: string; init: RequestInit }[] = []
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const server = (answer: (url: string, init: RequestInit) => Response) => vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => { calls.push({ url, init }); return answer(url, init) }))

const detectBody = { faces: [{ face_rectangle: { width: 140, top: 89, left: 104, height: 141 }, face_token: 'one' }], image_id: 'i', request_id: 'r' }
const compareBody = {
  faces1: [{ face_rectangle: { width: 156, top: 210, left: 142, height: 156 }, face_token: 'a' }],
  faces2: [{ face_rectangle: { width: 140, top: 89, left: 104, height: 141 }, face_token: 'b' }],
  confidence: 89.485,
  thresholds: { '1e-3': 62.327 },
  image_id1: 'i1', image_id2: 'i2', request_id: 'r',
}

beforeEach(() => {
  for (const k of env) { keep[k] = process.env[k]; delete process.env[k] }
  setSetting('faceConfig', '')
  setSetting(`faceUsage:${month()}`, '')
  calls.length = 0
})
afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of env) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k] }
  setSetting('faceConfig', '')
})

describe('cloud faces', () => {
  it('is off until the owner connects a service', async () => {
    expect(facesInfo()).toMatchObject({ enabled: false, label: null, where: null })
    await expect(scanFaces(editor, { photo: image(), references: [] })).rejects.toMatchObject({ status: 409 })
  })

  it('checks the key without sending a photo, keeps the keys away, and is owner-only', async () => {
    server((url) => url.endsWith('/getfacesets') ? json({ facesets: [] }) : json(detectBody))
    const status = await saveFaces(owner, { provider: 'facepp', key: 'fp-secret-key-1234', secret: 'fp-secret-5678', limitRequests: 5 })
    expect(JSON.stringify(status)).not.toContain('fp-secret-key-1234')
    expect(JSON.stringify(status)).not.toContain('fp-secret-5678')
    expect(status.current).toMatchObject({ provider: 'facepp', keyEnding: '1234', secretEnding: '5678', limitRequests: 5 })
    expect(calls[0].url).toBe('https://api-us.faceplusplus.com/facepp/v3/faceset/getfacesets')
    expect(calls[0].init.body).toBeInstanceOf(FormData)
    expect(facesInfo()).toMatchObject({ enabled: true, label: 'Face++ (Megvii)' })
    await expect(saveFaces(editor, { provider: 'facepp', key: 'x' })).rejects.toMatchObject({ status: 403 })
    expect(() => facesStatus(editor)).toThrow()
  })

  it('shows a refused key as the owner\'s problem', async () => {
    server(() => json({ error: 'bad' }, 401))
    await expect(saveFaces(owner, { provider: 'facepp', key: 'wrong', secret: 'wrong' })).rejects.toMatchObject({ status: 400 })
    // AWS says a wrong key with 400 and a reason, not with 401.
    server(() => json({ __type: 'UnrecognizedClientException', message: 'The security token included in the request is invalid.' }, 400))
    await expect(saveFaces(owner, { provider: 'rekognition', key: 'AKIAWRONG', secret: 'wrong' })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/ключ/) })
  })

  it('needs the secret for Amazon Rekognition and Face++', async () => {
    await expect(saveFaces(owner, { provider: 'facepp', key: 'k' })).rejects.toMatchObject({ status: 400 })
    await expect(saveFaces(owner, { provider: 'rekognition', key: 'k' })).rejects.toMatchObject({ status: 400 })
  })

  it('finds faces and suggests a person, counts the provider calls, and never lets a reader trigger it', async () => {
    server((url) => url.endsWith('/getfacesets') ? json({ facesets: [] }) : url.endsWith('/detect') ? json(detectBody) : json(compareBody))
    await saveFaces(owner, { provider: 'facepp', key: 'fp-secret-key-1234', secret: 'fp-secret-5678', limitRequests: 10 })
    const out = await scanFaces(editor, { photo: image(), references: [{ personId: 'p1', photo: image('BB') }] })
    expect(out.faces).toHaveLength(1)
    expect(out.matches).toEqual([{ personId: 'p1', score: 0.895, box: expect.objectContaining({ x: expect.any(Number) }) }])
    const detect = calls.find((c) => c.url.endsWith('/detect'))!
    const form = detect.init.body as FormData
    expect(form.get('api_key')).toBe('fp-secret-key-1234')
    expect(form.get('api_secret')).toBe('fp-secret-5678')
    expect(facesStatus(owner).usage).toMatchObject({ requests: 2 })
    await expect(scanFaces(reader, { photo: image(), references: [] })).rejects.toMatchObject({ status: 403 })
  })

  it('stops at the monthly limit the owner set', async () => {
    server((url) => url.endsWith('/getfacesets') ? json({ facesets: [] }) : json(detectBody))
    await saveFaces(owner, { provider: 'facepp', key: 'fp-secret-key-1234', secret: 'fp-secret-5678', limitRequests: 1 })
    await expect(scanFaces({ ...editor, userId: 'face-limit' }, { photo: image(), references: [{ personId: 'p1', photo: image() }] })).rejects.toMatchObject({ status: 429 })
  })

  it('lets the server\'s environment win over the app, and then the app cannot change it', async () => {
    process.env.FACE_PROVIDER = 'facepp'
    process.env.FACE_API_KEY = 'env-key-9999'
    process.env.FACE_API_SECRET = 'env-secret-8888'
    server((url) => url.endsWith('/detect') ? json(detectBody) : json(compareBody))
    expect(facesInfo()).toMatchObject({ enabled: true, label: 'Face++ (Megvii)' })
    expect(facesStatus(owner).current).toMatchObject({ source: 'server', keyEnding: '9999', secretEnding: '8888' })
    await expect(saveFaces(owner, { provider: 'facepp', key: 'k', secret: 's' })).rejects.toMatchObject({ status: 409 })
    expect(() => removeFaces(owner)).toThrow()
    const out = await scanFaces({ ...editor, userId: 'face-env' }, { photo: image(), references: [] })
    expect(out.provider).toBe('facepp')
  })

  it('tests the key with a blank picture, and can be taken away', async () => {
    server((url) => url.endsWith('/getfacesets') ? json({ facesets: [] }) : json({ faces: [] }))
    await saveFaces(owner, { provider: 'facepp', key: 'fp-secret-key-1234', secret: 'fp-secret-5678' })
    await expect(testFaces(owner)).resolves.toEqual({ ok: true })
    expect(removeFaces(owner).current).toBeNull()
    expect(facesInfo().enabled).toBe(false)
  })

  it('gives a custom CompreFace a required address', async () => {
    await expect(saveFaces(owner, { provider: 'compreface', key: 'k' })).rejects.toMatchObject({ status: 400 })
    server(() => json({ subjects: [] }))
    const status = await saveFaces(owner, { provider: 'compreface', key: 'k', baseUrl: 'https://faces.example.org' })
    expect(status.current).toMatchObject({ provider: 'compreface', baseUrl: 'https://faces.example.org' })
  })

  it('refuses photos that are too large before calling the service', async () => {
    server((url) => url.endsWith('/getfacesets') ? json({ facesets: [] }) : json(detectBody))
    await saveFaces(owner, { provider: 'facepp', key: 'fp-secret-key-1234', secret: 'fp-secret-5678' })
    const huge = { data: `data:image/jpeg;base64,${Buffer.alloc(11 * 1024 * 1024).toString('base64')}`, width: 1000, height: 1000 }
    await expect(scanFaces({ ...editor, userId: 'face-big' }, { photo: huge, references: [] })).rejects.toMatchObject({ status: 413 })
  })
})
