// A link that asks for a story gives the holder one power: to send a recording that waits for review.
import { beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../lib/ops/core'

const owner: Actor = { userId: 'o', name: 'Owner', role: 'owner', personId: null }
const editor: Actor = { userId: 'e', name: 'Editor', role: 'editor', personId: null }
// The shortest thing that is recognised as sound: an Ogg page header.
const SOUND = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(200)])

let requests: typeof import('../lib/ops/story-requests')
let people: typeof import('../lib/ops/people')
let proposals: typeof import('../lib/ops/proposals')
let stories: typeof import('../lib/ops/stories')
let aboutId = ''
let token = ''

beforeAll(async () => {
  ;[requests, people, proposals, stories] = await Promise.all([import('../lib/ops/story-requests'), import('../lib/ops/people'), import('../lib/ops/proposals'), import('../lib/ops/stories')])
  aboutId = people.createPerson(owner, { givenName: 'Дед', surname: 'Рассказный', deathDate: '1980' }).id
  people.createPerson(owner, { givenName: 'Посторонний', surname: 'Невидимый', deathDate: '1970' })
  ;({ token } = requests.createRequest(owner, { personId: aboutId, tellerName: 'Бабушка Нина', question: 'Как вы познакомились?' }))
})

describe('asking for a story by a link', () => {
  it('shows only who it is about and the question', () => {
    const info = requests.requestInfo(token)!
    expect(info).toMatchObject({ about: 'Дед Рассказный', tellerName: 'Бабушка Нина', question: 'Как вы познакомились?' })
    expect(Object.keys(info).sort()).toEqual(['about', 'familyName', 'question', 'tellerName'])
    expect(JSON.stringify(info)).not.toContain('Невидимый')
  })

  it('is the owner\'s to make and to see', () => {
    expect(() => requests.createRequest(editor, { personId: aboutId })).toThrow()
    expect(() => requests.listRequests(editor)).toThrow()
  })

  it('changes nothing until someone accepts it', async () => {
    const before = stories.listStories(owner, aboutId).length
    await requests.submitRecording(token, { buf: SOUND, name: 'voice' }, 42)
    expect(stories.listStories(owner, aboutId).length).toBe(before)
    const waiting = proposals.listProposals(owner).flatMap((p: { ops: { op: string }[] }) => p.ops).filter((o: { op: string }) => o.op === 'create_story')
    expect(waiting.length).toBe(1)
    expect(requests.listRequests(owner)[0].received).toBe(1)
  })

  it('takes a story once accepted, with the voice, and says who told it', () => {
    const draft = proposals.listProposals(owner).find((p: { ops: { op: string }[] }) => p.ops.some((o) => o.op === 'create_story'))!
    proposals.acceptProposal(owner, draft.id)
    const told = stories.listStories(owner, aboutId)
    expect(told).toHaveLength(1)
    expect(told[0]).toMatchObject({ tellerName: 'Бабушка Нина', hasAudio: true, durationSec: 42 })
  })

  it('refuses what is not sound, a wrong token and a closed link', async () => {
    await expect(requests.submitRecording(token, { buf: Buffer.from('<script>'), name: 'x.html' }, null)).rejects.toThrow()
    await expect(requests.submitRecording('nope', { buf: SOUND, name: 'v' }, null)).rejects.toThrow()
    expect(requests.requestInfo('nope')).toBeNull()
    requests.closeRequest(owner, requests.listRequests(owner)[0].id)
    expect(requests.requestInfo(token)).toBeNull()
    await expect(requests.submitRecording(token, { buf: SOUND, name: 'v' }, null)).rejects.toThrow()
  })
})

describe('a link with several questions', () => {
  it('keeps up to five, one a line, and names each recording by the one chosen', async () => {
    const { token: many } = requests.createRequest(owner, { personId: aboutId, question: '  Где родились?\n\nКак жили?\nРаз\nДва\nТри\nЧетыре' })
    expect(requests.requestInfo(many)!.question.split('\n')).toEqual(['Где родились?', 'Как жили?', 'Раз', 'Два', 'Три'])
    await requests.submitRecording(many, { buf: SOUND, name: 'v' }, 5, 1)
    await requests.submitRecording(many, { buf: SOUND, name: 'v' }, 5, 99)
    for (const draft of proposals.listProposals(owner)) proposals.acceptProposal(owner, draft.id)
    const titles = stories.listStories(owner, aboutId).map((s) => s.title)
    expect(titles).toEqual(expect.arrayContaining(['Как жили?', 'Где родились?']))
    expect(titles.filter((x) => x === 'Где родились?')).toHaveLength(1)
  })
})
