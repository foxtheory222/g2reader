import { DEFAULT_DENSITY, DENSITY_PRESETS, type Density } from './reader-ui'

export interface StoredPosition {
  pageIndex: number
  pageCount: number
  density: Density
}

export interface PositionStore {
  save(bookId: string, pageIndex: number, pageCount: number, density: Density): void
  restore(bookId: string, currentPageCount: number, density: Density): number
}

const KEY_PREFIX = 'g2reader:position:'

function keyFor(bookId: string) {
  return `${KEY_PREFIX}${bookId}`
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function normalizeBoundary(value: number) {
  return isNonNegativeSafeInteger(value) ? value : 0
}

function clampPage(pageIndex: number, pageCount: number) {
  if (pageCount <= 0) return 0
  return Math.min(pageIndex, pageCount - 1)
}

export function remapPageIndex(oldIndex: number, oldCount: number, newCount: number): number {
  const safeOldCount = normalizeBoundary(oldCount)
  const safeNewCount = normalizeBoundary(newCount)
  if (safeOldCount <= 1 || safeNewCount <= 1) return 0
  const safeOldIndex = clampPage(normalizeBoundary(oldIndex), safeOldCount)
  return clampPage(Math.round((safeOldIndex / (safeOldCount - 1)) * (safeNewCount - 1)), safeNewCount)
}

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}

function parsePosition(raw: string | null): StoredPosition | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const candidate = value as Partial<StoredPosition>
    if (!isNonNegativeSafeInteger(candidate.pageIndex) || !isNonNegativeSafeInteger(candidate.pageCount)) {
      return null
    }
    // Records from slices 1-2 predate density persistence and used eight lines.
    const density = candidate.density === undefined ? 8 : candidate.density
    if (!DENSITY_PRESETS.includes(density as Density)) return null
    return { pageIndex: candidate.pageIndex, pageCount: candidate.pageCount, density: density as Density }
  } catch {
    return null
  }
}

export function createPositionStore(storage?: Storage | null): PositionStore {
  const durable = storage === undefined ? browserStorage() : storage
  const session = new Map<string, StoredPosition>()

  return {
    save(bookId, pageIndex, pageCount, density) {
      const normalizedCount = normalizeBoundary(pageCount)
      const value: StoredPosition = {
        pageIndex: clampPage(normalizeBoundary(pageIndex), normalizedCount),
        pageCount: normalizedCount,
        density: DENSITY_PRESETS.includes(density) ? density : DEFAULT_DENSITY,
      }
      const key = keyFor(bookId)
      const serialized = JSON.stringify(value)
      session.set(key, value)
      try {
        durable?.setItem(key, serialized)
      } catch {
        // The in-memory copy keeps this session coherent when storage is
        // denied or full. Persistence failure must never block rendering.
      }
    },

    restore(bookId, currentPageCount, density) {
      const normalizedCount = normalizeBoundary(currentPageCount)
      if (normalizedCount === 0) return 0
      const key = keyFor(bookId)
      const sessionValue = session.get(key)
      if (sessionValue) {
        return sessionValue.density === density
          ? clampPage(sessionValue.pageIndex, normalizedCount)
          : remapPageIndex(sessionValue.pageIndex, sessionValue.pageCount, normalizedCount)
      }

      let raw: string | null = null
      try {
        raw = durable?.getItem(key) ?? null
      } catch {
        raw = null
      }
      const value = parsePosition(raw)
      if (value) session.set(key, value)
      if (!value) return 0
      return value.density === density
        ? clampPage(value.pageIndex, normalizedCount)
        : remapPageIndex(value.pageIndex, value.pageCount, normalizedCount)
    },
  }
}
