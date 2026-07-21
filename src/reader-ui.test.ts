import { describe, expect, it } from 'vitest'
import {
  cycleDensity,
  cycleProgressStyle,
  menuBody,
  moveMenuSelection,
  progressFooter,
  readerLayout,
  resolveBootBookId,
} from './reader-ui'

describe('reader menu', () => {
  it('renders the four decided items, cursor, and the retired reader hints inside the menu', () => {
    expect(menuBody(1, 'percent', 6)).toBe([
      '  Continue',
      '> Progress: percent',
      '  Density: 6 lines',
      '  Library',
      'scroll: move · tap: select · double-tap: exit',
    ].join('\n'))
  })

  it('clamps menu cursor movement to its four items', () => {
    expect(moveMenuSelection(0, -1)).toBe(0)
    expect(moveMenuSelection(0, 1)).toBe(1)
    expect(moveMenuSelection(3, 1)).toBe(3)
  })
})

describe('reader progress footer', () => {
  it('cycles percent to page to hidden to percent', () => {
    expect(cycleProgressStyle('percent')).toBe('page')
    expect(cycleProgressStyle('page')).toBe('hidden')
    expect(cycleProgressStyle('hidden')).toBe('percent')
  })

  it('renders exactly one rounded percent, page count, or empty footer', () => {
    expect(progressFooter('percent', 41, 99)).toBe('42%')
    expect(progressFooter('page', 36, 112)).toBe('Page 37 / 112')
    expect(progressFooter('hidden', 36, 112)).toBe('')
    expect(progressFooter('percent', 0, 1)).toBe('100%')
  })
})

describe('reader density and resume', () => {
  it('cycles the decided 5, 6, and 8 line presets', () => {
    expect(cycleDensity(5)).toBe(6)
    expect(cycleDensity(6)).toBe(8)
    expect(cycleDensity(8)).toBe(5)
  })

  it.each([5, 6, 8] as const)('uses an exact %s-line inner box and keeps footer inside 288px', density => {
    const layout = readerLayout(density)
    expect(layout.bodyHeight - 2 * layout.bodyPadding).toBe(density * 27)
    expect(layout.footerY).toBe(layout.bodyHeight + 6)
    expect(layout.footerY + layout.footerHeight).toBe(288)
  })

  it('resumes only when the last active id still exists', () => {
    expect(resolveBootBookId('imported', ['alice', 'imported'])).toBe('imported')
    expect(resolveBootBookId('removed', ['alice', 'imported'])).toBeNull()
    expect(resolveBootBookId(null, ['alice'])).toBeNull()
  })
})
