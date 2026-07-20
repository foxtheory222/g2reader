import { inflateSync } from 'node:zlib'

const EXPECTED_WIDTH = 576
const EXPECTED_HEIGHT = 288

export function decodeRgbaPng(png) {
  const signature = '89504e470d0a1a0a'
  if (png.subarray(0, 8).toString('hex') !== signature) throw new Error('Screenshot is not a PNG')
  let offset = 8
  let width = 0
  let height = 0
  const idat = []
  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.subarray(offset + 4, offset + 8).toString('ascii')
    const data = png.subarray(offset + 8, offset + 8 + length)
    offset += length + 12
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (width !== EXPECTED_WIDTH || height !== EXPECTED_HEIGHT) {
        throw new Error(`Expected ${EXPECTED_WIDTH}x${EXPECTED_HEIGHT} simulator screenshot, got ${width}x${height}`)
      }
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) {
        throw new Error('Expected a non-interlaced 8-bit RGBA simulator screenshot')
      }
    }
    if (type === 'IDAT') idat.push(data)
    if (type === 'IEND') break
  }

  const packed = inflateSync(Buffer.concat(idat))
  const stride = width * 4
  const expectedPackedLength = height * (stride + 1)
  if (packed.length !== expectedPackedLength) {
    throw new Error(`Unexpected packed RGBA length ${packed.length}; expected ${expectedPackedLength}`)
  }

  const pixels = Buffer.alloc(stride * height)
  let source = 0
  for (let y = 0; y < height; y++) {
    const filter = packed[source++]
    const row = pixels.subarray(y * stride, (y + 1) * stride)
    const previous = y ? pixels.subarray((y - 1) * stride, y * stride) : undefined
    for (let x = 0; x < stride; x++) {
      const raw = packed[source++]
      const left = x >= 4 ? row[x - 4] : 0
      const up = previous?.[x] ?? 0
      const upperLeft = previous && x >= 4 ? previous[x - 4] : 0
      if (filter === 0) row[x] = raw
      else if (filter === 1) row[x] = raw + left
      else if (filter === 2) row[x] = raw + up
      else if (filter === 3) row[x] = raw + Math.floor((left + up) / 2)
      else if (filter === 4) {
        const estimate = left + up - upperLeft
        const pa = Math.abs(estimate - left)
        const pb = Math.abs(estimate - up)
        const pc = Math.abs(estimate - upperLeft)
        row[x] = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft)
      } else throw new Error(`Unsupported PNG filter ${filter}`)
    }
  }
  return { width, height, pixels }
}

export function screenshotsMatchPixels(leftPng, rightPng) {
  return decodeRgbaPng(leftPng).pixels.equals(decodeRgbaPng(rightPng).pixels)
}

export function pixelDifferenceRegion(leftPng, rightPng, yStart = 0, yEnd = EXPECTED_HEIGHT) {
  if (!Number.isInteger(yStart) || !Number.isInteger(yEnd) || yStart < 0 || yEnd > EXPECTED_HEIGHT || yStart >= yEnd) {
    throw new Error(`Invalid screenshot region y=${yStart}..${yEnd}`)
  }
  const left = decodeRgbaPng(leftPng)
  const right = decodeRgbaPng(rightPng)
  let changed = 0
  for (let y = yStart; y < yEnd; y++) {
    for (let x = 0; x < EXPECTED_WIDTH; x++) {
      const index = (y * EXPECTED_WIDTH + x) * 4
      if (!left.pixels.subarray(index, index + 4).equals(right.pixels.subarray(index, index + 4))) changed++
    }
  }
  return changed
}
