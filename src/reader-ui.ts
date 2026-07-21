export const DENSITY_PRESETS = [5, 6, 8] as const
export type Density = typeof DENSITY_PRESETS[number]
export const DEFAULT_DENSITY: Density = 6

export const PROGRESS_STYLES = ['percent', 'page', 'hidden'] as const
export type ProgressStyle = typeof PROGRESS_STYLES[number]
export const DEFAULT_PROGRESS_STYLE: ProgressStyle = 'percent'

export const MENU_ITEM_COUNT = 4
const LINE_HEIGHT = 27
const SCREEN_HEIGHT = 288
const BODY_PADDING = 4
const BODY_FOOTER_GAP = 6

export interface ReaderLayout {
  bodyHeight: number
  bodyPadding: number
  footerY: number
  footerHeight: number
}

export function readerLayout(density: Density): ReaderLayout {
  const bodyHeight = density * LINE_HEIGHT + 2 * BODY_PADDING
  const footerY = bodyHeight + BODY_FOOTER_GAP
  return {
    bodyHeight,
    bodyPadding: BODY_PADDING,
    footerY,
    footerHeight: SCREEN_HEIGHT - footerY,
  }
}

export function cycleDensity(current: Density): Density {
  const index = DENSITY_PRESETS.indexOf(current)
  return DENSITY_PRESETS[(index + 1) % DENSITY_PRESETS.length]
}

export function cycleProgressStyle(current: ProgressStyle): ProgressStyle {
  const index = PROGRESS_STYLES.indexOf(current)
  return PROGRESS_STYLES[(index + 1) % PROGRESS_STYLES.length]
}

export function moveMenuSelection(current: number, delta: -1 | 1): number {
  return Math.max(0, Math.min(MENU_ITEM_COUNT - 1, current + delta))
}

export function menuBody(cursor: number, progressStyle: ProgressStyle, density: Density): string {
  const items = [
    'Continue',
    `Progress: ${progressStyle}`,
    `Density: ${density} lines`,
    'Library',
  ]
  return [
    ...items.map((item, index) => `${index === cursor ? '>' : ' '} ${item}`),
    'scroll: move · tap: select · double-tap: exit',
  ].join('\n')
}

export function progressFooter(style: ProgressStyle, pageIndex: number, pageCount: number): string {
  if (style === 'hidden') return ''
  const safeCount = Number.isSafeInteger(pageCount) && pageCount > 0 ? pageCount : 1
  const safeIndex = Number.isSafeInteger(pageIndex)
    ? Math.max(0, Math.min(pageIndex, safeCount - 1))
    : 0
  if (style === 'page') return `Page ${safeIndex + 1} / ${safeCount}`
  if (safeCount === 1) return '100%'
  return `${Math.round((safeIndex / (safeCount - 1)) * 100)}%`
}

export function resolveBootBookId(lastActiveBookId: string | null, bookIds: readonly string[]): string | null {
  return lastActiveBookId !== null && bookIds.includes(lastActiveBookId) ? lastActiveBookId : null
}
