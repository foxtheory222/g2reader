import { describe, expect, it } from 'vitest'
import type { Book } from './book-store'
import {
  MAX_LIBRARY_BODY_CHARACTERS,
  libraryBody,
  libraryFooter,
  moveLibrarySelection,
  sanitizeTitle,
  visibleLibraryBooks,
} from './library'

const books: Book[] = Array.from({ length: 7 }, (_, index) => ({
  id: `book-${index}`,
  title: `Book ${index + 1}`,
  text: `Text ${index + 1}`,
  source: index === 0 ? 'bundled' : 'imported',
}))

describe('glasses library', () => {
  it('shows at most five books with a text cursor', () => {
    expect(visibleLibraryBooks(books).map(book => book.title)).toEqual([
      'Book 1', 'Book 2', 'Book 3', 'Book 4', 'Book 5',
    ])
    expect(libraryBody(books, 2)).toBe(
      'LIBRARY\n\n  Book 1\n  Book 2\n> Book 3\n  Book 4\n  Book 5',
    )
  })

  it('clamps scroll selection to the visible list', () => {
    expect(moveLibrarySelection(0, -1, books.length)).toBe(0)
    expect(moveLibrarySelection(0, 1, books.length)).toBe(1)
    expect(moveLibrarySelection(4, 1, books.length)).toBe(4)
  })

  it('sanitizes control characters and truncates every title to one measured line', () => {
    const unsafe = `${'A very long title '.repeat(12)}\nInjected\u0007row`
    const clean = sanitizeTitle(unsafe)
    expect(clean).not.toMatch(/[\n\r\u0000-\u001F\u007F-\u009F]/)
    expect(libraryBody([{ ...books[0], title: unsafe }], 0)).toMatch(/^LIBRARY\n\n> .+…$/)
    expect(libraryBody([{ ...books[0], title: unsafe }], 0).split('\n')).toHaveLength(3)
  })

  it('strips supplementary tag controls and keeps five maximum titles within the structural ceiling', () => {
    const tagCharacters = String.fromCodePoint(0xe0061).repeat(128)
    const unsafeTitle = `Visible${tagCharacters} title ${'wide '.repeat(80)}`
    expect(unsafeTitle.length).toBeGreaterThan(266)
    expect(sanitizeTitle(unsafeTitle)).not.toContain(String.fromCodePoint(0xe0061))

    const maximumLibrary = libraryBody(
      Array.from({ length: 5 }, (_, index) => ({ ...books[index], title: unsafeTitle })),
      0,
    )
    expect(maximumLibrary.length).toBeLessThanOrEqual(MAX_LIBRARY_BODY_CHARACTERS)
    expect(maximumLibrary.split('\n')).toHaveLength(7)
  })

  it('shows the full or visible library count in the footer', () => {
    expect(libraryFooter(1)).toContain('1 book')
    expect(libraryFooter(5)).toContain('5 books')
    expect(libraryFooter(7)).toContain('1-5 of 7')
  })
})
