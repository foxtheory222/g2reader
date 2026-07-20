export interface DecodedRgbaPng {
  width: number
  height: number
  pixels: Buffer
}

export function decodeRgbaPng(png: Buffer): DecodedRgbaPng
export function screenshotsMatchPixels(leftPng: Buffer, rightPng: Buffer): boolean
export function pixelDifferenceRegion(leftPng: Buffer, rightPng: Buffer, yStart?: number, yEnd?: number): number
