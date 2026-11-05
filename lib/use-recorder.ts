'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

/** Chrome and Firefox make webm or ogg, Safari mp4. Each is kept as it came. */
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
/** The server takes 50 MB. At this rate an hour is about 23 MB, and a longer talk stops before it is refused. */
const BITS = 48_000
const MAX_SEC = 2 * 3600

export type RecorderProblem = 'insecure' | 'unsupported' | 'denied' | null

/** Records from the microphone. The microphone is let go as soon as recording stops or the dialog closes. */
export function useRecorder() {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [clip, setClip] = useState<{ blob: Blob; seconds: number } | null>(null)
  const [problem, setProblem] = useState<RecorderProblem>(null)
  const rec = useRef<MediaRecorder | null>(null)
  const timer = useRef<ReturnType<typeof setInterval>>(undefined)

  const stop = useCallback(() => {
    clearInterval(timer.current)
    if (rec.current?.state === 'recording') rec.current.stop()
  }, [])

  const start = useCallback(async () => {
    setProblem(null)
    if (!navigator.mediaDevices?.getUserMedia) return setProblem(window.isSecureContext ? 'unsupported' : 'insecure')
    if (typeof MediaRecorder === 'undefined') return setProblem('unsupported')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      return setProblem('denied')
    }
    const mimeType = TYPES.find((m) => MediaRecorder.isTypeSupported(m))
    const r = new MediaRecorder(stream, { audioBitsPerSecond: BITS, ...(mimeType ? { mimeType } : {}) })
    const parts: Blob[] = []
    const began = Date.now()
    r.ondataavailable = (e) => { if (e.data.size) parts.push(e.data) }
    r.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      setRecording(false)
      if (rec.current === r) setClip({ blob: new Blob(parts, { type: r.mimeType }), seconds: Math.round((Date.now() - began) / 1000) })
    }
    rec.current = r
    r.start(1000)
    setClip(null)
    setSeconds(0)
    setRecording(true)
    timer.current = setInterval(() => {
      const s = Math.round((Date.now() - began) / 1000)
      setSeconds(s)
      if (s >= MAX_SEC) stop()
    }, 500)
  }, [stop])

  const reset = useCallback(() => { rec.current = null; setClip(null); setSeconds(0) }, [])

  useEffect(() => () => {
    clearInterval(timer.current)
    const r = rec.current
    rec.current = null
    if (r?.state === 'recording') r.stop()
  }, [])

  return { recording, seconds, clip, problem, start, stop, reset }
}

export const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
