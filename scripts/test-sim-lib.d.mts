export interface DecodedRgbaPng {
  width: number
  height: number
  pixels: Buffer
}

export interface SimulatorConsoleEntry {
  level?: unknown
  type?: unknown
  message?: unknown
}

export function simulatorLaunchUrl(seedBook: boolean): string
export function decodeRgbaPng(png: Buffer): DecodedRgbaPng
export function screenshotsMatchPixels(leftPng: Buffer, rightPng: Buffer): boolean
export function pixelDifferenceRegion(leftPng: Buffer, rightPng: Buffer, yStart?: number, yEnd?: number): number
export function findSeriousConsoleEntries(
  entries: SimulatorConsoleEntry[],
  allowlist: RegExp[],
): SimulatorConsoleEntry[]
export function waitForChildReadiness<T>(readiness: Promise<T>, earlyFailure: Promise<Error>): Promise<T>
export function assertRequiredPortsFree(isOpen: (port: number) => Promise<boolean>): Promise<void>
export function stopAll(stoppers: Array<() => Promise<void>>): Promise<void>
