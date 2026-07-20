export interface StoredPosition {
  pageIndex: number
  pageCount: number
}

export interface PositionStore {
  save(bookId: string, pageIndex: number, pageCount: number): void
  restore(bookId: string, currentPageCount: number): number
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
    return { pageIndex: candidate.pageIndex, pageCount: candidate.pageCount }
  } catch {
    return null
  }
}

export function createPositionStore(storage?: Storage | null): PositionStore {
  const durable = storage === undefined ? browserStorage() : storage
  const fallback = new Map<string, string>()

  return {
    save(bookId, pageIndex, pageCount) {
      const normalizedCount = normalizeBoundary(pageCount)
      const value: StoredPosition = {
        pageIndex: clampPage(normalizeBoundary(pageIndex), normalizedCount),
        pageCount: normalizedCount,
      }
      const key = keyFor(bookId)
      const serialized = JSON.stringify(value)
      fallback.set(key, serialized)
      try {
        durable?.setItem(key, serialized)
      } catch {
        // The in-memory copy keeps this session coherent when storage is
        // denied or full. Persistence failure must never block rendering.
      }
    },

    restore(bookId, currentPageCount) {
      const normalizedCount = normalizeBoundary(currentPageCount)
      if (normalizedCount === 0) return 0
      const key = keyFor(bookId)
      let raw: string | null = null
      try {
        raw = durable?.getItem(key) ?? null
      } catch {
        raw = null
      }
      const value = parsePosition(raw) ?? parsePosition(fallback.get(key) ?? null)
      return value ? clampPage(value.pageIndex, normalizedCount) : 0
    },
  }
}
