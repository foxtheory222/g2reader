import type { Book } from './book-store'
import { measureTextWrap } from '@evenrealities/pretext'

export const MAX_VISIBLE_BOOKS = 5
export const MAX_LIBRARY_BODY_CHARACTERS = 1_000
const LIBRARY_LINE_WIDTH = 568
// Five rows plus "LIBRARY", row prefixes, and separators must fit the SDK's
// 1,000 UTF-16-unit startup/rebuild text-container ceiling.
const MAX_LIBRARY_TITLE_CHARACTERS = Math.floor(
  (MAX_LIBRARY_BODY_CHARACTERS - 'LIBRARY\n\n'.length - MAX_VISIBLE_BOOKS * 2 - (MAX_VISIBLE_BOOKS - 1)) /
  MAX_VISIBLE_BOOKS,
)

export function sanitizeTitle(title: string): string {
  return title.replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, ' ').replace(/\s+/gu, ' ').trim() || 'Untitled'
}

function titleFits(title: string): boolean {
  return title.length <= MAX_LIBRARY_TITLE_CHARACTERS && measureTextWrap(`> ${title}`, LIBRARY_LINE_WIDTH).lineCount <= 1
}

export function truncateLibraryTitle(title: string): string {
  const clean = sanitizeTitle(title)
  if (titleFits(clean)) return clean
  const points = Array.from(clean)
  let low = 0
  let high = points.length
  let best = '…'
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const candidate = `${points.slice(0, middle).join('').trimEnd()}…`
    if (titleFits(candidate)) {
      best = candidate
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return best
}

export function visibleLibraryBooks(books: readonly Book[]): Book[] {
  return books.slice(0, MAX_VISIBLE_BOOKS)
}

export function moveLibrarySelection(current: number, delta: -1 | 1, bookCount: number): number {
  const lastVisible = Math.max(0, Math.min(bookCount, MAX_VISIBLE_BOOKS) - 1)
  return Math.max(0, Math.min(lastVisible, current + delta))
}

export function libraryBody(books: readonly Book[], selectedIndex: number): string {
  const visible = visibleLibraryBooks(books)
  if (!visible.length) return 'LIBRARY\n\n(no books)'
  return [
    'LIBRARY',
    '',
    ...visible.map((book, index) => `${index === selectedIndex ? '>' : ' '} ${truncateLibraryTitle(book.title)}`),
  ].join('\n')
}

export function libraryFooter(bookCount: number): string {
  const count = bookCount > MAX_VISIBLE_BOOKS
    ? `1-${MAX_VISIBLE_BOOKS} of ${bookCount}`
    : `${bookCount} ${bookCount === 1 ? 'book' : 'books'}`
  return `${count}  ·  scroll: choose  ·  tap: open  ·  double-tap: exit`
}
