import type { Book } from './book-store'
import type { Density } from './reader-ui'

export type PageCache = Map<string, string[]>
export type PagesForBook = (book: Book, density: Density, cache: PageCache) => string[]

export function stageActiveBookPageCache(
  activeBook: Book,
  nextDensity: Density,
  pagesFor: PagesForBook,
): PageCache {
  const stagedCache: PageCache = new Map()
  pagesFor(activeBook, nextDensity, stagedCache)
  return stagedCache
}
