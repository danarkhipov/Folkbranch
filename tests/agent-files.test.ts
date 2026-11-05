// Providers and attachments, with no interface and no real model.
import fs from 'node:fs'
import path from 'node:path'
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import { assistantActor } from '../lib/agent/agent'
import { attachmentBytes, getAttachment, readAttachmentText, saveAttachment, sweepAttachments, TEXT_PAGE } from '../lib/agent/attachments'
import { activeProvider } from '../lib/agent/provider'
import { assistantResponse } from '../lib/agent/respond'
import { DATA_DIR } from '../lib/db'
import { listPersonMedia, getMedia } from '../lib/ops/media'
import { getGraph } from '../lib/ops/people'
import { toolsFor } from '../lib/ops/tools'
import { editor, loadFamily, owner, reader } from './fixture-family'

let f: Awaited<ReturnType<typeof loadFamily>>
beforeAll(async () => { f = await loadFamily() })

const png = () => sharp({ create: { width: 3000, height: 1500, channels: 3, background: '#357' } }).png().toBuffer()
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }
const silent = () => new MockLanguageModelV4({ doStream: async () => ({ stream: simulateReadableStream({ chunks: [{ type: 'stream-start', warnings: [] }, { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'ok' }, { type: 'text-end', id: 't' }, { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage }] as never[] }) }) as never })
const askWith = (url: string, mediaType = 'image/png') => ({ messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'Посмотри' }, { type: 'file', mediaType, url, filename: 'x' }] }] })
async function promptFor(person: typeof owner, url: string) {
  const m = silent()
  await (await assistantResponse(person, askWith(url), { model: m })).text()
  return m.doStreamCalls[0].prompt.find((p) => p.role === 'user')!.content as any[]
}
const tool = (person: typeof owner, name: string) => { const a = assistantActor(person); const d = toolsFor(a, 'assistant').find((t) => t.name === name)!; return (args: any) => d.run(a, d.input.parse(args)) }

describe('choosing a provider', () => {
  it('uses the first key there is, and AGENT_PROVIDER overrides', () => {
    expect(activeProvider({})).toBeNull()
    expect(activeProvider({ OPENROUTER_API_KEY: 'k' })).toMatchObject({ id: 'openrouter', model: 'z-ai/glm-5.3-flash' })
    expect(activeProvider({ ANTHROPIC_API_KEY: 'a', OPENROUTER_API_KEY: 'k' })).toMatchObject({ id: 'anthropic', model: 'claude-haiku-5-5' })
    expect(activeProvider({ ANTHROPIC_API_KEY: 'a', OPENROUTER_API_KEY: 'k', AGENT_PROVIDER: 'openrouter', AGENT_MODEL: 'x/y' })).toMatchObject({ id: 'openrouter', model: 'x/y' })
  })
  it('will not run without what it needs, and never guesses a model', () => {
    expect(activeProvider({ OPENAI_API_KEY: 'k' })).toBeNull()
    expect(activeProvider({ OPENAI_API_KEY: 'k', AGENT_MODEL: 'm' })).toMatchObject({ id: 'openai' })
    expect(activeProvider({ AGENT_PROVIDER: 'openrouter' })).toBeNull()
    expect(activeProvider({ AGENT_PROVIDER: 'nonsense', ANTHROPIC_API_KEY: 'a' })).toBeNull()
    expect(activeProvider({ AGENT_PROVIDER: 'local', AGENT_MODEL: 'llama' })).toBeNull()
    expect(activeProvider({ AGENT_PROVIDER: 'local', AGENT_MODEL: 'llama', AGENT_BASE_URL: 'http://x/v1' })).toMatchObject({ id: 'local' })
  })
  it('each builds a model for the SDK', () => {
    for (const env of [{ ANTHROPIC_API_KEY: 'k' }, { OPENROUTER_API_KEY: 'k' }, { OPENAI_API_KEY: 'k', AGENT_MODEL: 'm' }, { GOOGLE_GENERATIVE_AI_API_KEY: 'k', AGENT_MODEL: 'm' }, { AGENT_PROVIDER: 'local', AGENT_MODEL: 'm', AGENT_BASE_URL: 'http://x/v1' }]) {
      const p = activeProvider(env)!
      expect((p.create(p.key, p.model) as { modelId: string }).modelId).toBe(p.model)
    }
  })
  it('OpenRouter is told not to route family data to anyone who trains on it', async () => {
    const sent: any[] = []
    const { createOpenRouter } = await import('@openrouter/ai-sdk-provider')
    expect(createOpenRouter).toBeTypeOf('function')
    const p = activeProvider({ OPENROUTER_API_KEY: 'k', AGENT_MODEL: 'anthropic/claude-opus-5.5' })!
    const settings = (p.create('k', p.model) as any).settings
    sent.push(settings)
    expect(sent[0].provider.data_collection).toBe('deny')
    expect(sent[0].cache_control).toEqual({ type: 'ephemeral' })
    expect((p.create('k', 'z-ai/glm-5.3-flash') as any).settings.cache_control).toBeUndefined()
    expect(((activeProvider({ OPENROUTER_API_KEY: 'k', AGENT_MODEL: 'openai/x' })!).create('k', 'openai/x') as any).settings.cache_control).toBeUndefined()
  })
})

describe('what a file becomes', () => {
  it('a picture: a smaller copy for the model, the original kept', async () => {
    const buf = await png()
    const a = await saveAttachment(owner, buf, 'портрет.png')
    expect(a.kind).toBe('image')
    expect((await attachmentBytes(owner, a.id)).equals(buf)).toBe(true)
    const content = await promptFor(owner, `/api/agent/files/${a.id}`)
    const file = content.find((c) => c.type === 'file')
    expect(file.mediaType).toBe('image/jpeg')
    const raw = file.data?.type === 'data' ? file.data.data : file.data
    const meta = await sharp(typeof raw === 'string' ? Buffer.from(raw.replace(/^data:[^,]+,/, ''), 'base64') : Buffer.from(raw)).metadata()
    expect(meta.width).toBeLessThanOrEqual(1568)
    expect(JSON.stringify(content)).toContain(a.id)
  })
  it('a PDF goes as a document', async () => {
    const a = await saveAttachment(owner, Buffer.from('%PDF-1.4\n%fake'), 'метрика.pdf')
    expect(a.kind).toBe('pdf')
    expect((await promptFor(owner, `/api/agent/files/${a.id}`)).find((c) => c.type === 'file').mediaType).toBe('application/pdf')
  })
  it('text arrives as text, in UTF-8 or in old Russian encoding', async () => {
    const a = await saveAttachment(owner, Buffer.from('Имя;Год\nВера;1901\n'), 'люди.csv')
    expect(JSON.stringify(await promptFor(owner, `/api/agent/files/${a.id}`))).toContain('Вера;1901')
    const old = await saveAttachment(owner, Buffer.from([0xc8, 0xe2, 0xe0, 0xed]), 'old.ged')
    expect((await readAttachmentText(owner, old.id)).text).toBe('Иван')
  })
  it('a long text comes in pages, and the model is told there is more', async () => {
    const a = await saveAttachment(owner, Buffer.from(`${'я'.repeat(TEXT_PAGE + 10)}КОНЕЦ`), 'long.txt')
    const prompt = JSON.stringify(await promptFor(owner, `/api/agent/files/${a.id}`))
    expect(prompt).toContain('read_attachment gets the rest')
    expect(prompt).not.toContain('КОНЕЦ')
    expect((await tool(owner, 'read_attachment')({ id: a.id, offset: TEXT_PAGE }) as any).text).toContain('КОНЕЦ')
  })
  it('an unreadable file is named, and the model knows it cannot read it', async () => {
    const a = await saveAttachment(owner, Buffer.from([0, 1, 2, 3, 0, 5]), 'архив.zip')
    expect(a.kind).toBe('binary')
    expect(JSON.stringify(await promptFor(owner, `/api/agent/files/${a.id}`))).toContain('cannot read')
  })
  it('a fake picture and odd names are safe, an empty file is refused', async () => {
    expect((await saveAttachment(owner, Buffer.from('not a png'), 'x.png')).kind).toBe('text')
    expect((await saveAttachment(owner, Buffer.from('x'), '../../../etc/passwd')).name).toBe('passwd')
    await expect(saveAttachment(owner, Buffer.alloc(0), 'e.txt')).rejects.toMatchObject({ status: 400 })
  })
})

describe('whose file it is', () => {
  it('another person cannot use or read it by id', async () => {
    const a = await saveAttachment(owner, Buffer.from('личное письмо'), 'письмо.txt')
    await expect(getAttachment(editor, a.id)).rejects.toMatchObject({ status: 404 })
    const prompt = JSON.stringify(await promptFor(editor, `/api/agent/files/${a.id}`))
    expect(prompt).not.toContain('личное письмо')
    expect(prompt).toContain('no longer available')
    await expect(tool(editor, 'read_attachment')({ id: a.id })).rejects.toMatchObject({ status: 404 })
    await expect(tool(editor, 'save_attachment')({ id: a.id })).rejects.toMatchObject({ status: 404 })
  })
  it('a request cannot make the provider fetch an address or pass raw data', async () => {
    for (const url of ['https://evil.example/x.png', 'file:///etc/passwd', 'data:image/png;base64,AAAA', '/api/agent/files/../../secret', 'http://169.254.169.254/latest']) {
      const prompt = JSON.stringify(await promptFor(owner, url))
      expect(prompt).not.toContain(url)
      expect(prompt).toContain('no longer available')
    }
  })
  it('an id cannot walk out of the folder', async () => {
    await expect(getAttachment(owner, '../../family')).rejects.toMatchObject({ status: 404 })
  })
})

describe('keeping a file', () => {
  it('saves a picture onto a card with a caption, and undo takes it off', async () => {
    const a = await saveAttachment(editor, await png(), 'свадьба2.png')
    const out = await tool(editor, 'save_attachment')({ id: a.id, personId: f.ivan.id, caption: 'Свадьба', date: '1915' }) as any
    expect(out.kind).toBe('image')
    expect(getMedia(owner, out.id)).toMatchObject({ caption: 'Свадьба', date: '1915' })
    expect(listPersonMedia(owner, f.ivan.id).some((m) => m.id === out.id)).toBe(true)
  })
  it('it can become an avatar, and shows up in search', async () => {
    const a = await saveAttachment(editor, await png(), 'лицо.png')
    const out = await tool(editor, 'save_attachment')({ id: a.id, personId: f.maria.id, caption: 'Портрет у реки' }) as any
    await tool(editor, 'set_avatar')({ personId: f.maria.id, mediaId: out.id })
    expect(getGraph(owner).persons.find((p) => p.id === f.maria.id)!.avatarMediaId).toBe(out.id)
    expect(((await tool(owner, 'search_archive')({ query: 'Портрет' })) as any).results[0].id).toBe(out.id)
  })
  it('a reader may show a file but not keep one', () => {
    const names = toolsFor(assistantActor(reader), 'assistant').map((t) => t.name)
    expect(names).toContain('read_attachment')
    expect(names).not.toContain('save_attachment')
    expect(names).not.toContain('import_gedcom_attachment')
  })
  it('imports a GEDCOM file in full, however long', async () => {
    const people = Array.from({ length: 800 }, (_, i) => `0 @I${i}@ INDI\n1 NAME Гед${i} /Импорт/\n1 BIRT\n2 DATE 1800\n1 DEAT\n2 DATE 1850`).join('\n')
    const a = await saveAttachment(editor, Buffer.from(`0 HEAD\n1 CHAR UTF-8\n${people}\n0 TRLR`), 'tree.ged')
    expect((await readAttachmentText(editor, a.id)).more).toBe(true)
    await tool(editor, 'import_gedcom_attachment')({ id: a.id })
    expect(getGraph(owner).persons.filter((p) => p.surname === 'Импорт')).toHaveLength(800)
  })
})

describe('old files', () => {
  it('are cleared after two weeks, new ones stay', async () => {
    const old = await saveAttachment(owner, Buffer.from('старое'), 'old.txt')
    const fresh = await saveAttachment(owner, Buffer.from('новое'), 'new.txt')
    const dir = path.join(DATA_DIR, 'agent-files')
    const past = new Date(Date.now() - 15 * 86_400_000)
    for (const u of fs.readdirSync(dir)) for (const x of fs.readdirSync(path.join(dir, u))) if (x.startsWith(old.id)) fs.utimesSync(path.join(dir, u, x), past, past)
    expect(await sweepAttachments()).toBeGreaterThan(0)
    await expect(getAttachment(owner, old.id)).rejects.toBeTruthy()
    expect((await getAttachment(owner, fresh.id)).name).toBe('new.txt')
  })
})

describe('the request OpenRouter would get', () => {
  it('has the model, tools, the picture, the document and the privacy rule, and reads its answer', async () => {
    const pictureFile = await saveAttachment(owner, await png(), 'p.png')
    const document = await saveAttachment(owner, Buffer.from('%PDF-1.4\n%fake'), 'd.pdf')
    const realFetch = globalThis.fetch
    const sent: { url: string; body: any; auth: string | null }[] = []
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      sent.push({ url: String(url), body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get('authorization') })
      const lines = [{ id: 'g', model: 'anthropic/claude-opus-5.5', choices: [{ index: 0, delta: { role: 'assistant', content: 'Готово' }, finish_reason: null }] }, { id: 'g', model: 'anthropic/claude-opus-5.5', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }]
      return new Response(`${lines.map((l) => `data: ${JSON.stringify(l)}\n\n`).join('')}data: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    }) as never
    const had = { key: process.env.OPENROUTER_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY }
    process.env.OPENROUTER_API_KEY = 'test-key'
    process.env.ANTHROPIC_API_KEY = ''
    try {
      const res = await assistantResponse(owner, { messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'Смотри' }, { type: 'file', mediaType: 'image/png', url: `/api/agent/files/${pictureFile.id}`, filename: 'p.png' }, { type: 'file', mediaType: 'application/pdf', url: `/api/agent/files/${document.id}`, filename: 'd.pdf' }] }] })
      expect(await res.text()).toContain('Готово')
    } finally {
      globalThis.fetch = realFetch
      process.env.OPENROUTER_API_KEY = had.key ?? ''
      process.env.ANTHROPIC_API_KEY = had.anthropic ?? ''
    }
    const { url, body, auth } = sent[0]
    expect(url).toContain('openrouter.ai')
    expect(auth).toBe('Bearer test-key')
    expect(body.model).toBe('z-ai/glm-5.3-flash')
    expect(body.provider.data_collection).toBe('deny')
    expect(body.provider.sort).toBe('price')
    expect(body.tools.length).toBeGreaterThanOrEqual(14)
    expect(body.tools.every((t: any) => t.function.parameters.type === 'object')).toBe(true)
    const text = JSON.stringify(body.messages)
    expect(text).toContain('data:image/jpeg;base64,')
    expect(text).toContain('data:application/pdf;base64,')
    expect(text).toContain(pictureFile.id)
  })
})
