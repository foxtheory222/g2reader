import type { Durability, ListBooksResult } from './book-store'

export function importSuccessMessage(title: string, durability: Durability): string {
  return durability === 'durable'
    ? `Imported ${title}.`
    : `Imported ${title} (this session only — storage unavailable).`
}

export function removalSuccessMessage(title: string, durability: Durability): string {
  return durability === 'durable'
    ? `Removed ${title}.`
    : `Removed ${title} for this session only — storage unavailable.`
}

export function importRefreshFailureMessage(title: string, durability: Durability): string {
  return durability === 'durable'
    ? `Imported ${title}: saved — glasses refresh failed. It will retry on the next glasses action.`
    : `Imported ${title} for this session only — glasses refresh failed; storage unavailable. It will retry on the next glasses action.`
}

export function removalRefreshFailureMessage(title: string, durability: Durability): string {
  return durability === 'durable'
    ? `Removed ${title}: saved — glasses refresh failed. It will retry on the next glasses action.`
    : `Removed ${title} for this session only — glasses refresh failed; storage unavailable. It will retry on the next glasses action.`
}

export function startupStorageNotice(result: Pick<ListBooksResult, 'durability' | 'invalidRecordCount'>): string | null {
  if (result.durability === 'session-only') {
    return 'Storage unavailable. Imported books from earlier sessions could not be loaded; new imports last for this session only.'
  }
  if (result.invalidRecordCount > 0) {
    const noun = result.invalidRecordCount === 1 ? 'record was' : 'records were'
    return `${result.invalidRecordCount} stored book ${noun} invalid and could not be loaded.`
  }
  return null
}
