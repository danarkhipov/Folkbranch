// The face services' answers, checked against samples copied from their own documentation.
import { describe, expect, it } from 'vitest'
import { FACE_PRESETS, faceChoices, facePreset } from '../lib/faces/presets'

const sample = (id: string) => facePreset(id)!
const size = { width: 1000, height: 1000 }
const near = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 5)

describe('cloud face presets', () => {
  it('reads Amazon Rekognition DetectFaces', () => {
    // https://docs.aws.amazon.com/rekognition/latest/APIReference/API_DetectFaces.html
    const body = {
      FaceDetails: [{
        BoundingBox: { Width: 0.7919622659683228, Height: 0.7510867118835449, Left: 0.08881539851427078, Top: 0.151064932346344 },
        Confidence: 99.85968780517578,
      }],
    }
    const [face] = sample('rekognition').parseDetect(body, size)
    near(face.x, 0.0888153985)
    near(face.y, 0.1510649323)
    near(face.w, 0.791962266)
    near(face.h, 0.7510867119)
    near(face.score!, 0.998596878)
  })

  it('reads Amazon Rekognition CompareFaces', () => {
    // https://docs.aws.amazon.com/rekognition/latest/APIReference/API_CompareFaces.html
    const body = {
      FaceMatches: [{
        Face: { BoundingBox: { Height: 0.18, Left: 0.55, Top: 0.33, Width: 0.24 }, Confidence: 99.9 },
        Similarity: 98.5,
      }],
      SourceImageFace: { BoundingBox: { Height: 0.2, Left: 0.1, Top: 0.1, Width: 0.2 }, Confidence: 99.9 },
      UnmatchedFaces: [],
    }
    const match = sample('rekognition').parseCompare(body, size)!
    near(match.score, 0.985)
    near(match.box!.x, 0.55)
    near(match.box!.w, 0.24)
  })

  it('reads Face++ Detect', () => {
    // https://console.faceplusplus.com/documents/5679127
    const body = {
      image_id: 'Dd2xUw9S/7yjr0oDHHSL/Q==',
      request_id: '1470472868,dacf2ff1-ea45-4842-9c07-6e8418cea78b',
      time_used: 752,
      faces: [{ face_rectangle: { width: 140, top: 89, left: 104, height: 141 }, face_token: 'ed319e807e039ae669a4d1af0922a0c8' }],
    }
    const [face] = sample('facepp').parseDetect(body, size)
    near(face.x, 0.104)
    near(face.y, 0.089)
    near(face.w, 0.14)
    near(face.h, 0.141)
  })

  it('reads Face++ Compare', () => {
    // https://console.faceplusplus.com/documents/5679308
    const body = {
      faces1: [{ face_rectangle: { width: 156, top: 210, left: 142, height: 156 }, face_token: '1ee9de6d362b0c8c1bf240a70fbf3eac' }],
      faces2: [{ face_rectangle: { width: 75, top: 44, left: 53, height: 75 }, face_token: 'ad87092cb593128c015c2e2221b962f2' }],
      time_used: 533,
      thresholds: { '1e-3': 62.327, '1e-5': 73.975, '1e-4': 69.101 },
      confidence: 89.485,
      image_id1: 'Fc64vrBtETVmP2cS+BoW/Q==',
      image_id2: 'Y74JtlTEfR3Jb/pyoNzT1Q==',
      request_id: '1535365156,7db9798d-2c80-4bd0-9773-6e40ef5088c2',
    }
    const match = sample('facepp').parseCompare(body, size)!
    near(match.score, 0.89485)
    near(match.box!.x, 0.053)
    near(match.box!.h, 0.075)
  })

  it('reads Luxand.cloud face rectangles', () => {
    // https://luxand.cloud/face-recognition-blog/guide-how-to-build-emotion-recognition-application-with-javascript
    const body = { status: 'success', faces: [{ rectangle: { top: 321, left: 329, bottom: 678, right: 686 } }] }
    const [face] = sample('luxand').parseDetect(body, size)
    near(face.x, 0.329)
    near(face.y, 0.321)
    near(face.w, 0.357)
    near(face.h, 0.357)
  })

  it('reads Luxand.cloud confidence', () => {
    // https://luxand.cloud/face-verification-api, with the confidence field documented for recognition
    const match = sample('luxand').parseCompare({ status: 'success', confidence: 97.389 }, size)!
    near(match.score, 0.97389)
  })

  it('reads CompreFace detection with its face vector', () => {
    // https://github.com/exadel-inc/CompreFace/blob/master/docs/Rest-API-description.md
    const body = {
      result: [{
        embedding: [-0.03027934394776821, 0.011, -0.05117142200469971],
        box: { probability: 0.9987509250640869, x_max: 376, y_max: 479, x_min: 68, y_min: 77 },
      }],
    }
    const [face] = sample('compreface').parseDetect(body, size)
    near(face.x, 0.068)
    near(face.y, 0.077)
    near(face.w, 0.308)
    near(face.h, 0.402)
    near(face.score!, 0.998750925)
    expect(face.embedding).toHaveLength(3)
  })

  it('reads CompreFace recognition', () => {
    // https://github.com/exadel-inc/CompreFace/blob/master/docs/How-to-Use-CompreFace.md
    const body = { result: [{ box: { probability: 0.99583, x_max: 551, y_max: 364, x_min: 319, y_min: 55 }, subjects: [{ similarity: 0.99593, subject: 'lisan' }] }] }
    const match = sample('compreface').parseCompare(body, size)!
    near(match.score, 0.99593)
    near(match.box!.x, 0.319)
    near(match.box!.h, 0.309)
  })

  it('sends the browser only plain choices, never the parsers', () => {
    expect(FACE_PRESETS).toHaveLength(4)
    for (const preset of faceChoices()) {
      expect(Object.values(preset).some((v) => typeof v === 'function')).toBe(false)
      expect(preset.label).not.toBe('')
    }
  })
})
