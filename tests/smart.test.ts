// What runs on the device: how it is rated, how long recordings are cut, and when a face gets a name.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { rateDevice } from '../lib/smart/device'
import { splitAtQuiet } from '../lib/smart/audio'
import { bestMatch, SAME_PERSON } from '../lib/smart/face-match'

describe('the device', () => {
  const base = { cores: 8, memoryGB: 8, saveData: false }
  it('never asks a weak device for the larger model', () => {
    expect(rateDevice({ ...base, cores: 4 })).toBe('weak')
    expect(rateDevice({ ...base, memoryGB: 2 })).toBe('weak')
    expect(rateDevice({ ...base, saveData: true })).toBe('weak')
  })
  it('wants plenty of cores before calling it strong', () => {
    expect(rateDevice(base)).toBe('strong')
    expect(rateDevice({ ...base, cores: 6 })).toBe('normal')
  })
  it('does not fail where the browser reports nothing', () => {
    expect(rateDevice({ cores: null, memoryGB: null, saveData: false })).toBe('normal')
  })
})

describe('cutting a recording', () => {
  const rate = 100
  it('covers all of it, with no gaps and no piece too long', () => {
    const samples = new Float32Array(rate * 95).fill(0.5)
    const pieces = splitAtQuiet(samples, rate, 28)
    expect(pieces[0][0]).toBe(0)
    expect(pieces.at(-1)![1]).toBe(samples.length)
    for (let i = 1; i < pieces.length; i++) expect(pieces[i][0]).toBe(pieces[i - 1][1])
    for (const [a, b] of pieces) expect(b - a).toBeLessThanOrEqual(rate * 28)
  })
  it('cuts in the pause', () => {
    const samples = new Float32Array(rate * 40).fill(0.5)
    samples.fill(0, rate * 26, rate * 27)
    expect(Math.abs(splitAtQuiet(samples, rate, 28)[0][1] - rate * 26.5)).toBeLessThan(rate)
  })
  it('leaves a short recording whole', () => {
    expect(splitAtQuiet(new Float32Array(rate * 5), rate, 28)).toEqual([[0, rate * 5]])
    expect(splitAtQuiet(new Float32Array(0), rate, 28)).toEqual([])
  })
})

describe('naming a face', () => {
  it('stays silent when nobody is close enough', () => {
    expect(bestMatch([{ personId: 'a', score: SAME_PERSON - 0.01 }])).toBeNull()
    expect(bestMatch([])).toBeNull()
  })
  it('stays silent when two people are about equally close', () => {
    expect(bestMatch([{ personId: 'a', score: 0.8 }, { personId: 'b', score: 0.75 }])).toBeNull()
  })
  it('takes each person by their closest photo', () => {
    expect(bestMatch([{ personId: 'a', score: 0.6 }, { personId: 'a', score: 0.9 }, { personId: 'b', score: 0.7 }])).toEqual({ personId: 'a', score: 0.9 })
  })
})

describe('the speech runtime', () => {
  it('fetches the same version the package uses', () => {
    const lock = readFileSync('pnpm-lock.yaml', 'utf8').match(/onnxruntime-web@([^:\s'(]+)/)![1]
    expect(readFileSync('lib/smart/speech.ts', 'utf8')).toContain(`const ORT = '${lock}'`)
  })
})
