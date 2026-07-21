import type { Book, BookStore, Durability } from './book-store'
import type { EpubExtractionResult } from './epub-extract'
import type { PdfExtractionResult } from './pdf-extract'

export interface PickedFile {
  name: string
  size: number
  type?: string
  arrayBuffer(): Promise<ArrayBuffer>
}

interface ImportDependencies {
  store: BookStore
  extractEpub(data: ArrayBuffer, filename?: string): Promise<EpubExtractionResult>
  extractPdf(data: ArrayBuffer): Promise<PdfExtractionResult>
}

export type FileImportResult =
  | { status: 'ready'; book: Book; durability: Durability; warnings?: Array<'columns' | 'coverage'> }
  | { status: 'unsupported'; reason: string }

export const MAX_PDF_BYTES = 25 * 1024 * 1024
export const MAX_EPUB_BYTES = 25 * 1024 * 1024
export const MAX_TXT_BYTES = 8 * 1024 * 1024

export async function importBookFile(
  file: PickedFile,
  dependencies: ImportDependencies,
): Promise<FileImportResult> {
  const lowerName = file.name.toLowerCase()
  const mediaType = file.type?.toLowerCase().split(';')[0].trim() ?? ''
  const recognizedExtension = lowerName.endsWith('.txt')
    ? 'txt'
    : lowerName.endsWith('.epub')
      ? 'epub'
      : lowerName.endsWith('.pdf')
        ? 'pdf'
        : null
  if (recognizedExtension === 'txt') {
    if (file.size > MAX_TXT_BYTES) {
      return { status: 'unsupported', reason: 'This TXT file exceeds the 8 MB import limit.' }
    }
    let data: ArrayBuffer
    try {
      data = await file.arrayBuffer()
    } catch {
      return { status: 'unsupported', reason: 'This file could not be read.' }
    }
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(data)
    } catch {
      return { status: 'unsupported', reason: 'This file is not valid UTF-8 text.' }
    }
    if (!text.trim()) return { status: 'unsupported', reason: 'This text file is empty.' }
    const imported = await dependencies.store.importText(file.name, text)
    return { status: 'ready', ...imported }
  }

  if (recognizedExtension === 'epub' || (!recognizedExtension && mediaType === 'application/epub+zip')) {
    if (file.size > MAX_EPUB_BYTES) {
      return { status: 'unsupported', reason: 'This EPUB exceeds the 25 MB import limit.' }
    }
    let data: ArrayBuffer
    try {
      data = await file.arrayBuffer()
    } catch {
      return { status: 'unsupported', reason: 'This file could not be read.' }
    }
    const extracted = await dependencies.extractEpub(data, file.name)
    if (extracted.status === 'unsupported') {
      return { status: 'unsupported', reason: extracted.reason }
    }
    const imported = await dependencies.store.importText(file.name, extracted.text, {
      title: extracted.meta.title,
      author: extracted.meta.author,
      chapterOffsets: extracted.meta.chapterOffsets,
    })
    return { status: 'ready', ...imported }
  }

  if (recognizedExtension !== 'pdf') {
    return { status: 'unsupported', reason: 'Choose a PDF, EPUB, or TXT file.' }
  }

  if (file.size > MAX_PDF_BYTES) {
    return { status: 'unsupported', reason: 'This PDF exceeds the 25 MB import limit.' }
  }

  let data: ArrayBuffer
  try {
    data = await file.arrayBuffer()
  } catch {
    return { status: 'unsupported', reason: 'This file could not be read.' }
  }
  const extracted = await dependencies.extractPdf(data)
  if (extracted.status === 'unsupported') {
    return { status: 'unsupported', reason: extracted.reason }
  }
  const imported = await dependencies.store.importText(file.name, extracted.text, {
    columnsSuspected: extracted.meta.columnsSuspected,
    pageCharOffsets: extracted.meta.pageCharOffsets,
  })
  return {
    status: 'ready',
    ...imported,
    ...(
      extracted.meta.columnsSuspected || extracted.meta.coverageWarning
        ? {
            warnings: [
              ...(extracted.meta.columnsSuspected ? ['columns' as const] : []),
              ...(extracted.meta.coverageWarning ? ['coverage' as const] : []),
            ],
          }
        : {}
    ),
  }
}
