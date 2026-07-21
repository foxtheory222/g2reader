import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  assertRequiredPortsFree,
  decodeRgbaPng,
  findSeriousConsoleEntries,
  pixelDifferenceRegion,
  simulatorLaunchUrl,
  screenshotsMatchPixels,
  stopAll,
  waitForChildReadiness,
} from '../scripts/test-sim-lib.mjs'

function chunk(type: string, data: Buffer) {
  const result = Buffer.alloc(12 + data.length)
  result.writeUInt32BE(data.length, 0)
  result.write(type, 4, 'ascii')
  data.copy(result, 8)
  return result
}

function png(width: number, height: number, pixels: Buffer, level = 6) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const rows: Buffer[] = []
  for (let y = 0; y < height; y++) {
    rows.push(Buffer.from([0]), pixels.subarray(y * width * 4, (y + 1) * width * 4))
  }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

describe('simulator screenshot proof', () => {
  it('compares decoded pixels instead of PNG encoding bytes', () => {
    const pixels = Buffer.alloc(576 * 288 * 4, 42)
    const fast = png(576, 288, pixels, 1)
    const small = png(576, 288, pixels, 9)
    expect(fast.equals(small)).toBe(false)
    expect(screenshotsMatchPixels(fast, small)).toBe(true)
  })

  it('validates the expected 576x288 simulator dimensions', () => {
    expect(() => decodeRgbaPng(png(2, 2, Buffer.alloc(16)))).toThrow(/576x288/)
  })

  it('separates body y=0..245 from footer y=246..287', () => {
    const base = Buffer.alloc(576 * 288 * 4)
    const bodyChanged = Buffer.from(base)
    const footerChanged = Buffer.from(base)
    bodyChanged[(245 * 576) * 4] = 255
    footerChanged[(246 * 576) * 4] = 255

    const baselinePng = png(576, 288, base)
    const bodyPng = png(576, 288, bodyChanged)
    const footerPng = png(576, 288, footerChanged)
    expect(pixelDifferenceRegion(baselinePng, bodyPng, 0, 246)).toBe(1)
    expect(pixelDifferenceRegion(baselinePng, bodyPng, 246, 288)).toBe(0)
    expect(pixelDifferenceRegion(baselinePng, footerPng, 0, 246)).toBe(0)
    expect(pixelDifferenceRegion(baselinePng, footerPng, 246, 288)).toBe(1)
  })
})

describe('simulator harness safety', () => {
  it('seeds only the first launch and uses the unseeded origin for durability relaunch', () => {
    expect(simulatorLaunchUrl(true)).toBe('http://127.0.0.1:4173/?simSeedBook=1')
    expect(simulatorLaunchUrl(false)).toBe('http://127.0.0.1:4173/')
  })

  it('flags error-level, uncaught, and unhandled-rejection console entries', () => {
    const entries = [
      { level: 'error', message: 'bridge failed' },
      { level: 'info', message: '[uncaught] boom' },
      { level: 'info', message: '[unhandledrejection] nope' },
      { level: 'info', message: 'G2_READER_READY' },
    ]
    expect(findSeriousConsoleEntries(entries, [])).toEqual(entries.slice(0, 3))
  })

  it('fails readiness immediately when the child exits first', async () => {
    const neverReady = new Promise<string>(() => undefined)
    await expect(waitForChildReadiness(neverReady, Promise.resolve(new Error('preview exited'))))
      .rejects.toThrow('preview exited')
  })

  it('checks both required ports and reports either occupied port', async () => {
    const checked: number[] = []
    await expect(assertRequiredPortsFree(async port => {
      checked.push(port)
      return port === 4173
    })).rejects.toThrow('4173')
    expect(checked.sort()).toEqual([4173, 9898])
  })

  it('settles every child stop and aggregates cleanup failures', async () => {
    const stopped: number[] = []
    const cleanup = stopAll([
      async () => { stopped.push(1); throw new Error('first failed') },
      async () => { stopped.push(2) },
    ])
    await expect(cleanup).rejects.toBeInstanceOf(AggregateError)
    expect(stopped).toEqual([1, 2])
  })
})
