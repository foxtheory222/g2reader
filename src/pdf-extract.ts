import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { hasMostlyGarbageText } from './text-quality'

export {
  hasMostlyGarbageText,
  MAX_MOJIBAKE_PREFIX_RATIO,
  MAX_SINGLE_CHARACTER_RATIO,
  MIN_CHARACTER_ENTROPY,
} from './text-quality'

if (typeof window !== 'undefined') GlobalWorkerOptions.workerSrc = workerUrl

export interface PdfExtractionMeta {
  pageCount: number
  charCount: number
  pageCharOffsets: number[]
  columnsSuspected: boolean
  textPageCount: number
  pageErrorCount: number
  textCoverage: number
  coverageWarning?: boolean
}

export type PdfExtractionResult =
  | { status: 'ready'; text: string; meta: PdfExtractionMeta }
  | { status: 'unsupported'; reason: string; meta: PdfExtractionMeta }

interface PdfTextItem {
  str: string
  dir?: string
  transform: number[]
  width: number
  height: number
}

interface PositionedItem {
  text: string
  x: number
  y: number
  width: number
  height: number
}

interface Span {
  minX: number
  maxX: number
}

interface ReconstructedLine {
  text: string
  y: number
  height: number
  spans: Span[]
}

interface ExtractedPage {
  height: number
  width: number
  lines: ReconstructedLine[]
}

const SCANNED_REASON = 'This PDF contains scanned images, not text. OCR is not available in this offline reader.'
const GARBAGE_REASON = 'This PDF text is mostly unreadable because its character encoding is unsupported.'
const ENCRYPTED_REASON = 'This PDF is encrypted. Remove its password and try again.'
const RTL_REASON = 'This PDF uses RTL text direction, which is unvalidated and unsupported in this reader.'
const ROTATED_REASON = 'This PDF uses predominantly rotated/vertical text, which is unvalidated and unsupported in this reader.'
export const MAX_PDF_PAGES = 3_000
export const MAX_EXTRACTED_CHARACTERS = 4_000_000
export const FURNITURE_EDGE_BAND_RATIO = 0.15

const CHARACTER_LIMIT_REASON = 'This PDF exceeds the 4,000,000 characters extraction limit.'

function emptyMeta(pageCount = 0, pageCharOffsets: number[] = []): PdfExtractionMeta {
  return {
    pageCount,
    charCount: 0,
    pageCharOffsets,
    columnsSuspected: false,
    textPageCount: 0,
    pageErrorCount: 0,
    textCoverage: 0,
  }
}

function isTextItem(value: unknown): value is PdfTextItem {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PdfTextItem>
  return (
    typeof candidate.str === 'string' &&
    Array.isArray(candidate.transform) &&
    candidate.transform.length >= 6 &&
    typeof candidate.width === 'number' &&
    typeof candidate.height === 'number'
  )
}

function itemHeight(item: PdfTextItem): number {
  const transformHeight = Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0)
  return Math.max(1, item.height || transformHeight || 1)
}

function normalizeItem(item: PdfTextItem): PositionedItem | null {
  const text = item.str.replace(/\s+/gu, ' ').trim()
  if (!text) return null
  return {
    text,
    x: item.transform[4] ?? 0,
    y: item.transform[5] ?? 0,
    width: Math.max(0, item.width),
    height: itemHeight(item),
  }
}

function sameBaseline(left: PositionedItem, right: PositionedItem): boolean {
  return Math.abs(left.y - right.y) <= Math.max(2, Math.min(left.height, right.height) * 0.3)
}

function joinLineItems(items: PositionedItem[]): ReconstructedLine {
  const ordered = [...items].sort((left, right) => left.x - right.x)
  let text = ''
  let previousEnd = ordered[0]?.x ?? 0
  const spans: Span[] = []
  let currentSpan: Span | null = null

  for (const item of ordered) {
    const gap = item.x - previousEnd
    const spacingThreshold = Math.max(0.8, item.height * 0.12)
    if (text && gap > spacingThreshold) text += ' '
    text += item.text

    const itemSpan = { minX: item.x, maxX: item.x + item.width }
    if (!currentSpan || gap > item.height * 2.5) {
      currentSpan = itemSpan
      spans.push(currentSpan)
    } else {
      currentSpan.maxX = Math.max(currentSpan.maxX, itemSpan.maxX)
    }
    previousEnd = Math.max(previousEnd, itemSpan.maxX)
  }

  return {
    text,
    y: ordered.reduce((total, item) => total + item.y, 0) / Math.max(1, ordered.length),
    height: Math.max(...ordered.map(item => item.height), 1),
    spans,
  }
}

function reconstructLines(rawItems: unknown[]): ReconstructedLine[] {
  const items = rawItems.filter(isTextItem).map(normalizeItem).filter(item => item !== null)
  items.sort((left, right) => right.y - left.y || left.x - right.x)

  const rows: PositionedItem[][] = []
  for (const item of items) {
    const row = rows.find(candidate => candidate[0] && sameBaseline(candidate[0], item))
    if (row) row.push(item)
    else rows.push([item])
  }
  return rows.map(joinLineItems).sort((left, right) => right.y - left.y)
}

function normalizedFurnitureText(text: string): string {
  return text.toLowerCase().replace(/\p{N}+/gu, '#').replace(/\s+/gu, ' ').trim()
}

function furnitureKeys(pages: ExtractedPage[]): Set<string> {
  const populations = new Map<string, Set<number>>()
  for (const [pageIndex, page] of pages.entries()) {
    for (const line of page.lines) {
      // PDF coordinates start at the bottom. Only the top and bottom 15% of
      // page height are eligible for repeated header/footer removal.
      if (!isFurnitureBand(line, page)) continue
      const normalized = normalizedFurnitureText(line.text)
      if (!normalized) continue
      const yBand = Math.round((line.y / Math.max(1, page.height)) * 20)
      const key = `${yBand}:${normalized}`
      const seenPages = populations.get(key) ?? new Set<number>()
      seenPages.add(pageIndex)
      populations.set(key, seenPages)
    }
  }
  const requiredPages = Math.max(3, Math.ceil(pages.length * 0.6))
  return new Set(
    [...populations.entries()]
      .filter(([, seenPages]) => seenPages.size >= requiredPages)
      .map(([key]) => key),
  )
}

function isFurnitureBand(line: ReconstructedLine, page: ExtractedPage): boolean {
  const ratio = line.y / Math.max(1, page.height)
  return ratio <= FURNITURE_EDGE_BAND_RATIO || ratio >= 1 - FURNITURE_EDGE_BAND_RATIO
}

function removeFurniture(pages: ExtractedPage[]): ExtractedPage[] {
  if (pages.length < 3) return pages
  const repeated = furnitureKeys(pages)
  return pages.map(page => ({
    ...page,
    lines: page.lines.filter(line => {
      if (!isFurnitureBand(line, page)) return true
      const yBand = Math.round((line.y / Math.max(1, page.height)) * 20)
      return !repeated.has(`${yBand}:${normalizedFurnitureText(line.text)}`)
    }),
  }))
}

function pageHasColumnGutter(page: ExtractedPage): boolean {
  const spans = page.lines.flatMap(line => line.spans)
  if (spans.length < 6 || page.width <= 0) return false
  const binCount = 48
  const occupancy = Array.from({ length: binCount }, () => 0)
  for (const span of spans) {
    const start = Math.max(0, Math.floor((span.minX / page.width) * binCount))
    const end = Math.min(binCount - 1, Math.floor((span.maxX / page.width) * binCount))
    for (let bin = start; bin <= end; bin++) occupancy[bin] += 1
  }

  let emptyRun = 0
  for (let bin = Math.floor(binCount * 0.25); bin <= Math.ceil(binCount * 0.75); bin++) {
    const x = ((bin + 0.5) / binCount) * page.width
    const left = spans.filter(span => span.maxX < x).length
    const right = spans.filter(span => span.minX > x).length
    const isGutter = occupancy[bin] <= Math.max(1, Math.floor(spans.length * 0.1)) && left >= 3 && right >= 3
    emptyRun = isGutter ? emptyRun + 1 : 0
    if (emptyRun >= 3) return true
  }
  return false
}

function corpusWords(pages: ExtractedPage[]): Set<string> {
  return new Set(pages.flatMap(page => page.lines.flatMap(line => (
    line.text.match(/\p{L}{2,}/gu) ?? []
  ))).map(word => word.toLocaleLowerCase()))
}

function formatPage(page: ExtractedPage, words: Set<string>): string {
  let output = ''
  for (const [index, line] of page.lines.entries()) {
    if (index === 0) {
      output = line.text
      continue
    }
    const previous = page.lines[index - 1]
    const prefix = output.match(/(\p{L}+)-$/u)?.[1]
    const suffix = line.text.match(/^(\p{Ll}\p{L}*)/u)?.[1]
    if (prefix && suffix && words.has(`${prefix}${suffix}`.toLocaleLowerCase())) {
      output = `${output.slice(0, -1)}${line.text}`
      continue
    }
    const verticalGap = previous.y - line.y
    const paragraphBreak = verticalGap > Math.max(previous.height, line.height) * 1.65
    output += `${paragraphBreak ? '\n\n' : '\n'}${line.text}`
  }
  return output.trim()
}

function offsetsForPages(pageTexts: string[]): number[] {
  const offsets: number[] = []
  let cursor = 0
  for (const [index, page] of pageTexts.entries()) {
    offsets.push(cursor)
    cursor += page.length
    if (index < pageTexts.length - 1) cursor += 2
  }
  return offsets
}

function normalizedAngle(degrees: number): number {
  return ((degrees + 180) % 360 + 360) % 360 - 180
}

function hasUnsupportedOrientation(item: PdfTextItem, pageRotation: number): boolean {
  const [a = 0, b = 0, c = 0, d = 0] = item.transform
  const determinant = a * d - b * c
  if (determinant < 0) return true
  const baselineAngle = Math.atan2(b, a) * 180 / Math.PI
  return Math.abs(normalizedAngle(baselineAngle + pageRotation)) > 45
}

function layoutCounts(rawItems: unknown[], pageRotation = 0) {
  const items = rawItems.filter(isTextItem).filter(item => item.str.trim())
  const counts = { total: 0, rtl: 0, rotated: 0 }
  for (const item of items) {
    const weight = Array.from(item.str.replace(/\s/gu, '')).length
    counts.total += weight
    if (item.dir?.toLowerCase() === 'rtl') counts.rtl += weight
    if (hasUnsupportedOrientation(item, pageRotation)) counts.rotated += weight
  }
  return counts
}

function classifyLayoutCounts(counts: { total: number; rtl: number; rotated: number }): string | null {
  if (!counts.total) return null
  if (counts.rtl / counts.total > 0.5) return RTL_REASON
  if (counts.rotated / counts.total > 0.5) return ROTATED_REASON
  return null
}

export function classifyUnsupportedLayout(rawItems: unknown[], pageRotation = 0): string | null {
  return classifyLayoutCounts(layoutCounts(rawItems, pageRotation))
}

export function classifyTextCoverage(textPageCount: number, pageCount: number) {
  const coverage = textPageCount / Math.max(1, pageCount)
  return {
    unsupported: pageCount > 3 && coverage < 0.7,
    warning: coverage >= 0.7 && coverage < 0.95,
  }
}

export function classifyPdfFailure(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const candidate = error as { name?: unknown; message?: unknown }
  const name = String(candidate.name ?? '')
  const message = String(candidate.message ?? '')
  return name === 'PasswordException' || /password|encrypted/i.test(message) ? ENCRYPTED_REASON : null
}

interface PdfPageLike {
  rotate?: number
  getViewport(options: { scale: number }): { width: number; height: number }
  getTextContent(): Promise<{ items: unknown[] }>
  cleanup(): void
}

interface PdfDocumentLike {
  numPages: number
  getPage?(pageNumber: number): Promise<PdfPageLike>
  destroy?(): Promise<void>
}

interface PdfExtractionOptions {
  loadDocument?: (data: ArrayBuffer) => Promise<PdfDocumentLike>
}

export async function extractPdfText(
  data: ArrayBuffer,
  options: PdfExtractionOptions = {},
): Promise<PdfExtractionResult> {
  let documentProxy: PdfDocumentLike
  let loadingTask: ReturnType<typeof getDocument> | null = null
  try {
    if (options.loadDocument) {
      documentProxy = await options.loadDocument(data)
    } else {
      loadingTask = getDocument({
        // PDF.js 6 transfers data.buffer in GetDocRequest, detaching the
        // transferred buffer. Keep the caller-owned File buffer intact.
        data: new Uint8Array(data.slice(0)),
        disableFontFace: true,
        useWorkerFetch: false,
      })
      documentProxy = await loadingTask.promise
    }
  } catch (error) {
    await loadingTask?.destroy()
    const encrypted = classifyPdfFailure(error)
    return {
      status: 'unsupported',
      reason: encrypted ?? `This PDF could not be read: ${error instanceof Error ? error.message : String(error)}`,
      meta: emptyMeta(),
    }
  }

  try {
    if (documentProxy.numPages > MAX_PDF_PAGES) {
      return {
        status: 'unsupported',
        reason: 'This PDF exceeds the 3,000 pages extraction limit.',
        meta: emptyMeta(documentProxy.numPages),
      }
    }

    const pages: ExtractedPage[] = []
    let pageErrorCount = 0
    let cumulativeRawCharacters = 0
    const layout = { total: 0, rtl: 0, rotated: 0 }
    for (let pageNumber = 1; pageNumber <= documentProxy.numPages; pageNumber++) {
      let page: PdfPageLike | null = null
      try {
        if (!documentProxy.getPage) throw new Error('PDF document has no page reader')
        page = await documentProxy.getPage(pageNumber)
        const viewport = page.getViewport({ scale: 1 })
        const content = await page.getTextContent()
        for (const item of content.items) {
          if (!item || typeof item !== 'object') continue
          const rawString = (item as { str?: unknown }).str
          if (typeof rawString !== 'string') continue
          cumulativeRawCharacters += rawString.length
          if (cumulativeRawCharacters > MAX_EXTRACTED_CHARACTERS) {
            return {
              status: 'unsupported',
              reason: CHARACTER_LIMIT_REASON,
              meta: { ...emptyMeta(documentProxy.numPages), pageErrorCount },
            }
          }
        }
        const counts = layoutCounts(content.items, page.rotate ?? 0)
        layout.total += counts.total
        layout.rtl += counts.rtl
        layout.rotated += counts.rotated
        const lines = reconstructLines(content.items)
        pages.push({ width: viewport.width, height: viewport.height, lines })
      } catch {
        pageErrorCount += 1
        pages.push({ width: 0, height: 0, lines: [] })
      } finally {
        page?.cleanup()
      }
    }

    const layoutReason = classifyLayoutCounts(layout)
    const cleanedPages = removeFurniture(pages)
    const textPageCount = cleanedPages.filter(page => page.lines.some(line => line.text.trim())).length
    const textCoverage = textPageCount / Math.max(1, documentProxy.numPages)
    const coverage = classifyTextCoverage(textPageCount, documentProxy.numPages)
    const words = corpusWords(cleanedPages)
    const pageTexts = cleanedPages.map(page => formatPage(page, words))
    const pageCharOffsets = offsetsForPages(pageTexts)
    const finalCharacterCount = pageTexts.reduce((total, pageText) => total + pageText.length, 0) +
      Math.max(0, pageTexts.length - 1) * 2
    if (finalCharacterCount > MAX_EXTRACTED_CHARACTERS) {
      return {
        status: 'unsupported',
        reason: CHARACTER_LIMIT_REASON,
        meta: {
          pageCount: documentProxy.numPages,
          charCount: 0,
          pageCharOffsets,
          columnsSuspected: pages.some(pageHasColumnGutter),
          textPageCount,
          pageErrorCount,
          textCoverage,
          ...(coverage.warning ? { coverageWarning: true } : {}),
        },
      }
    }
    const text = pageTexts.join('\n\n')
    const columnsSuspected = pages.some(pageHasColumnGutter)
    const commonMeta = {
      pageCount: documentProxy.numPages,
      pageCharOffsets,
      columnsSuspected,
      textPageCount,
      pageErrorCount,
      textCoverage,
      ...(coverage.warning ? { coverageWarning: true } : {}),
    }

    if (layoutReason) {
      return { status: 'unsupported', reason: layoutReason, meta: { ...commonMeta, charCount: text.length } }
    }
    if (coverage.unsupported) {
      return {
        status: 'unsupported',
        reason: `This PDF is unsupported because it contains mostly scanned/image pages (${textPageCount} of ${documentProxy.numPages} pages yielded text).`,
        meta: { ...commonMeta, charCount: text.length },
      }
    }
    if (!text.trim()) {
      return { status: 'unsupported', reason: SCANNED_REASON, meta: { ...commonMeta, charCount: 0 } }
    }
    if (hasMostlyGarbageText(text)) {
      return { status: 'unsupported', reason: GARBAGE_REASON, meta: { ...commonMeta, charCount: text.length } }
    }
    return { status: 'ready', text, meta: { ...commonMeta, charCount: text.length } }
  } finally {
    if (loadingTask) await loadingTask.destroy()
    else await documentProxy.destroy?.()
  }
}
