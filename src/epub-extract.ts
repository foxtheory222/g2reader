import JSZip, { type JSZipObject } from 'jszip'
import { titleFromFilename } from './book-store'
import { hasMostlyGarbageText } from './text-quality'

export interface EpubExtractionMeta {
  title?: string
  author?: string
  chapterCount: number
  charCount: number
  chapterOffsets: number[]
}

export type EpubExtractionResult =
  | { status: 'ready'; text: string; meta: EpubExtractionMeta }
  | { status: 'unsupported'; reason: string; meta: EpubExtractionMeta }

export interface EpubBudgets {
  maxEntryCount: number
  maxEntryUncompressedBytes: number
  maxTotalUncompressedBytes: number
  maxSpineItems: number
}

interface SpineItem {
  href: string
  fixedLayout: boolean
}

interface ManifestItem {
  path: string | null
  mediaType: string
}

interface PackageDetails {
  title?: string
  author?: string
  spineItems: SpineItem[]
  manifestByPath: Map<string, string>
}

interface LoadedEntryData {
  uncompressedSize?: number
  compression?: { magic?: string }
}

interface LoadedZipObject extends JSZipObject {
  _data?: LoadedEntryData
  internalStream(type: 'uint8array'): ChunkedStream
}

interface ChunkedStream {
  on(event: 'data', callback: (chunk: Uint8Array) => void): ChunkedStream
  on(event: 'end', callback: () => void): ChunkedStream
  on(event: 'error', callback: (error: Error) => void): ChunkedStream
  pause(): ChunkedStream
  resume(): ChunkedStream
}

interface InflationState {
  emittedBytes: number
  budgets: EpubBudgets
}

export const MAX_EPUB_CHARACTERS = 4_000_000
export const DEFAULT_EPUB_BUDGETS: Readonly<EpubBudgets> = Object.freeze({
  maxEntryCount: 2_000,
  maxEntryUncompressedBytes: 8 * 1024 * 1024,
  maxTotalUncompressedBytes: 64 * 1024 * 1024,
  maxSpineItems: 1_000,
})

const INVALID_EPUB_REASON = 'This file is not a valid EPUB.'
const DRM_REASON = 'This EPUB is DRM-protected and cannot be read.'
const FIXED_LAYOUT_REASON = 'This fixed-layout EPUB is unsupported; this reader requires reflowable text.'
const EMPTY_REASON = 'This EPUB does not contain readable text.'
const GARBAGE_REASON = 'This EPUB text is mostly unreadable because its character encoding is unsupported.'
const CHARACTER_LIMIT_REASON = 'This EPUB exceeds the 4,000,000 characters extraction limit.'
const XML_DECLARATION_REASON = 'This EPUB contains unsupported XML DTD or entity declarations.'
const EPUB_MIMETYPE = 'application/epub+zip'
const STORE_COMPRESSION_MAGIC = '\u0000\u0000'
const FONT_OBFUSCATION_ALGORITHMS = new Set([
  'http://www.idpf.org/2008/embedding',
  'http://ns.adobe.com/pdf/enc#RC',
])
const FONT_MEDIA_TYPES = new Set([
  'font/ttf',
  'application/font-sfnt',
  'font/otf',
  'application/vnd.ms-opentype',
  'font/woff',
  'application/font-woff',
  'font/woff2',
])
const BLOCK_ELEMENTS = new Set([
  'address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt', 'figcaption',
  'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li',
  'main', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th',
  'thead', 'tr', 'ul',
])

class EpubRefusal extends Error {
  constructor(readonly reason: string) {
    super(reason)
  }
}

function countLabel(value: number, unit: string): string {
  return `${value.toLocaleString('en-US')}-${unit}`
}

function byteLabel(value: number): string {
  return `${value.toLocaleString('en-US')}-byte`
}

function entryCountReason(budgets: EpubBudgets): string {
  return `This EPUB exceeds the ${countLabel(budgets.maxEntryCount, 'entry')} archive limit.`
}

function entryBytesReason(budgets: EpubBudgets): string {
  return `This EPUB exceeds the ${byteLabel(budgets.maxEntryUncompressedBytes)} per-entry decompression limit.`
}

function totalBytesReason(budgets: EpubBudgets): string {
  return `This EPUB exceeds the ${byteLabel(budgets.maxTotalUncompressedBytes)} cumulative decompression limit.`
}

function spineCountReason(budgets: EpubBudgets): string {
  return `This EPUB exceeds the ${countLabel(budgets.maxSpineItems, 'item')} spine limit.`
}

function emptyMeta(metadata: Partial<Pick<EpubExtractionMeta, 'title' | 'author'>> = {}): EpubExtractionMeta {
  return { ...metadata, chapterCount: 0, charCount: 0, chapterOffsets: [] }
}

function unsupported(reason: string, meta: EpubExtractionMeta): EpubExtractionResult {
  return { status: 'unsupported', reason, meta }
}

function localName(element: Element): string {
  return (element.localName || element.tagName.split(':').pop() || '').toLowerCase()
}

function allElements(root: Document | Element): Element[] {
  return Array.from(root.getElementsByTagName('*'))
}

function elementsNamed(root: Document | Element, name: string): Element[] {
  const expected = name.toLowerCase()
  return allElements(root).filter(element => localName(element) === expected)
}

function hasAncestor(element: Element, name: string): boolean {
  const expected = name.toLowerCase()
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (localName(parent) === expected) return true
  }
  return false
}

function parseXml(source: string): Document {
  if (/<!ENTITY\b|<!DOCTYPE\b[^>]*\[/iu.test(source)) throw new EpubRefusal(XML_DECLARATION_REASON)
  if (typeof globalThis.DOMParser !== 'function') throw new Error('DOMParser is unavailable')
  const document = new DOMParser().parseFromString(source, 'application/xml')
  if (!document.documentElement || localName(document.documentElement) === 'parsererror' || elementsNamed(document, 'parsererror').length) {
    throw new Error('Malformed XML')
  }
  return document
}

function normalizeZipPath(path: string): string | null {
  const pathOnly = path.replace(/\\/g, '/').split('#')[0].split('?')[0]
  let decoded: string
  try {
    decoded = decodeURIComponent(pathOnly)
  } catch {
    return null
  }
  const withoutSuffix = decoded.replace(/\\/g, '/')
  if (/^[a-z][a-z0-9+.-]*:/i.test(withoutSuffix)) return null
  const normalized: string[] = []
  for (const segment of withoutSuffix.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (!normalized.length) return null
      normalized.pop()
    } else {
      normalized.push(segment)
    }
  }
  return normalized.join('/') || null
}

function directoryOf(path: string): string {
  const separator = path.lastIndexOf('/')
  return separator < 0 ? '' : path.slice(0, separator + 1)
}

function resolveZipPath(baseDirectory: string, href: string): string | null {
  return normalizeZipPath(href.startsWith('/') ? href : `${baseDirectory}${href}`)
}

function findZipFile(zip: JSZip, path: string): LoadedZipObject | null {
  const normalized = normalizeZipPath(path)
  if (!normalized) return null
  return zip.file(normalized) as LoadedZipObject | null
}

function canonicalArchiveName(name: string, directory: boolean): string | null {
  if (!name || name.includes('\\') || name.startsWith('/')) return null
  const comparable = directory && name.endsWith('/') ? name.slice(0, -1) : name
  const segments = comparable.split('/')
  if (!segments.length || segments.some(segment => !segment || segment === '.' || segment === '..')) return null
  return segments.join('/').normalize('NFC') + (directory ? '/' : '')
}

function declaredSize(entry: LoadedZipObject): number {
  const value = entry._data?.uncompressedSize
  if (!Number.isSafeInteger(value) || (value ?? -1) < 0) throw new Error('Missing declared entry size')
  return value as number
}

function validateBudgets(overrides: Partial<EpubBudgets>): EpubBudgets {
  const budgets = { ...DEFAULT_EPUB_BUDGETS, ...overrides }
  for (const value of Object.values(budgets)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid EPUB budget')
  }
  return budgets
}

function preflightArchive(zip: JSZip, budgets: EpubBudgets): void {
  const entries = Object.values(zip.files) as LoadedZipObject[]
  if (entries.length > budgets.maxEntryCount) throw new EpubRefusal(entryCountReason(budgets))
  if (!entries.length || entries[0].dir || entries[0].name !== 'mimetype') throw new Error('Missing first mimetype entry')

  const exactNames = new Set<string>()
  const caseFoldedNames = new Set<string>()
  let totalDeclared = 0
  for (const entry of entries) {
    const originalName = entry.unsafeOriginalName ?? entry.name
    const canonical = canonicalArchiveName(originalName, entry.dir)
    if (!canonical || canonical !== entry.name || originalName !== entry.name) throw new Error('Unsafe archive entry name')
    if (exactNames.has(canonical)) throw new Error('Duplicate normalized archive entry')
    exactNames.add(canonical)
    const folded = canonical.toLocaleLowerCase('en-US')
    if (caseFoldedNames.has(folded)) throw new Error('Case-colliding archive entry')
    caseFoldedNames.add(folded)
    if (entry.dir) continue

    const size = declaredSize(entry)
    if (size > budgets.maxEntryUncompressedBytes) throw new EpubRefusal(entryBytesReason(budgets))
    totalDeclared += size
    if (!Number.isSafeInteger(totalDeclared) || totalDeclared > budgets.maxTotalUncompressedBytes) {
      throw new EpubRefusal(totalBytesReason(budgets))
    }
  }

  const mimetype = entries[0]
  if (declaredSize(mimetype) !== EPUB_MIMETYPE.length || mimetype._data?.compression?.magic !== STORE_COMPRESSION_MAGIC) {
    throw new Error('Invalid mimetype entry')
  }
}

async function readZipText(zip: JSZip, path: string, state: InflationState): Promise<string> {
  const entry = findZipFile(zip, path)
  if (!entry || entry.dir) throw new Error(`Missing EPUB entry: ${path}`)
  const stream = entry.internalStream('uint8array')
  const decoder = new TextDecoder()
  let entryBytes = 0
  let text = ''

  return new Promise<string>((resolve, reject) => {
    let settled = false
    const refuse = (reason: string) => {
      if (settled) return
      settled = true
      stream.pause()
      reject(new EpubRefusal(reason))
    }
    stream
      .on('data', chunk => {
        if (settled) return
        if (entryBytes + chunk.byteLength > state.budgets.maxEntryUncompressedBytes) {
          refuse(entryBytesReason(state.budgets))
          return
        }
        if (state.emittedBytes + chunk.byteLength > state.budgets.maxTotalUncompressedBytes) {
          refuse(totalBytesReason(state.budgets))
          return
        }
        entryBytes += chunk.byteLength
        state.emittedBytes += chunk.byteLength
        text += decoder.decode(chunk, { stream: true })
      })
      .on('error', error => {
        if (settled) return
        settled = true
        reject(error)
      })
      .on('end', () => {
        if (settled) return
        settled = true
        resolve(text + decoder.decode())
      })
      .resume()
  })
}

function descendantNamed(element: Element, name: string): Element | undefined {
  return elementsNamed(element, name)[0]
}

async function hasDrmProtection(
  zip: JSZip,
  manifestByPath: ReadonlyMap<string, string>,
  state: InflationState,
): Promise<boolean> {
  if (findZipFile(zip, 'META-INF/rights.xml')) return true
  const encryptionEntry = findZipFile(zip, 'META-INF/encryption.xml')
  if (!encryptionEntry) return false

  let document: Document
  try {
    document = parseXml(await readZipText(zip, 'META-INF/encryption.xml', state))
  } catch (error) {
    if (error instanceof EpubRefusal) throw error
    return true
  }
  const encryptedItems = elementsNamed(document, 'encrypteddata')
  if (!encryptedItems.length) return true
  return encryptedItems.some(item => {
    const algorithm = descendantNamed(item, 'encryptionmethod')?.getAttribute('Algorithm') ??
      descendantNamed(item, 'encryptionmethod')?.getAttribute('algorithm') ?? ''
    const uri = descendantNamed(item, 'cipherreference')?.getAttribute('URI') ??
      descendantNamed(item, 'cipherreference')?.getAttribute('uri') ?? ''
    const resourcePath = normalizeZipPath(uri)
    const mediaType = resourcePath ? manifestByPath.get(resourcePath) : undefined
    return !FONT_OBFUSCATION_ALGORITHMS.has(algorithm) ||
      !resourcePath ||
      !mediaType ||
      !FONT_MEDIA_TYPES.has(mediaType) ||
      !findZipFile(zip, resourcePath)
  })
}

function containerPackagePath(source: string): string {
  const document = parseXml(source)
  const rootfile = elementsNamed(document, 'rootfile').find(element => element.getAttribute('full-path'))
  const path = normalizeZipPath(rootfile?.getAttribute('full-path') ?? '')
  if (!path) throw new Error('Missing rootfile path')
  return path
}

function metadataText(document: Document, name: string): string | undefined {
  const value = elementsNamed(document, name)
    .find(element => hasAncestor(element, 'metadata'))
    ?.textContent?.replace(/\s+/gu, ' ').trim()
  return value || undefined
}

function packageLayout(document: Document): 'fixed' | 'reflowable' {
  const layout = elementsNamed(document, 'meta').find(element => {
    const property = element.getAttribute('property') ?? element.getAttribute('name') ?? ''
    return property.toLowerCase() === 'rendition:layout' && hasAncestor(element, 'metadata')
  })
  const value = (layout?.getAttribute('content') ?? layout?.textContent ?? '').trim().toLowerCase()
  return value === 'pre-paginated' ? 'fixed' : 'reflowable'
}

function parsePackage(source: string, packagePath: string, budgets: EpubBudgets): PackageDetails {
  const document = parseXml(source)
  if (localName(document.documentElement) !== 'package') throw new Error('Missing package root')
  const manifest = new Map<string, ManifestItem>()
  const manifestByPath = new Map<string, string>()
  const baseDirectory = directoryOf(packagePath)
  for (const item of elementsNamed(document, 'item').filter(element => hasAncestor(element, 'manifest'))) {
    const id = item.getAttribute('id')
    const href = item.getAttribute('href')
    const mediaType = (item.getAttribute('media-type') ?? '').trim().toLowerCase()
    if (!id || !href || !mediaType || manifest.has(id)) throw new Error('Invalid or duplicate manifest item')
    const path = resolveZipPath(baseDirectory, href)
    manifest.set(id, { path, mediaType })
    if (path) {
      const existing = manifestByPath.get(path)
      if (existing && existing !== mediaType) throw new Error('Ambiguous manifest resource')
      manifestByPath.set(path, mediaType)
    }
  }

  const references = elementsNamed(document, 'itemref').filter(element => hasAncestor(element, 'spine'))
  if (references.length > budgets.maxSpineItems) throw new EpubRefusal(spineCountReason(budgets))
  const defaultFixed = packageLayout(document) === 'fixed'
  const spineItems: SpineItem[] = []
  const resolvedSpinePaths = new Set<string>()
  for (const reference of references) {
    const idref = reference.getAttribute('idref')
    const manifestItem = idref ? manifest.get(idref) : undefined
    if (!manifestItem?.path || !manifestItem.mediaType.includes('html')) {
      throw new Error('Spine item is missing from the manifest')
    }
    if (resolvedSpinePaths.has(manifestItem.path)) throw new Error('Repeated spine resource')
    resolvedSpinePaths.add(manifestItem.path)
    const properties = new Set((reference.getAttribute('properties') ?? '').toLowerCase().split(/\s+/u).filter(Boolean))
    spineItems.push({
      href: manifestItem.path,
      fixedLayout: properties.has('rendition:layout-pre-paginated') ||
        (defaultFixed && !properties.has('rendition:layout-reflowable')),
    })
  }
  if (!spineItems.length) throw new Error('Missing readable spine')
  return {
    title: metadataText(document, 'title'),
    author: metadataText(document, 'creator'),
    spineItems,
    manifestByPath,
  }
}

function appendReadableText(node: Node, output: string[]): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      output.push(child.textContent?.replace(/\s+/gu, ' ') ?? '')
      continue
    }
    if (child.nodeType !== 1) continue
    const element = child as Element
    const name = localName(element)
    if (name === 'br') {
      output.push('\n')
      continue
    }
    const isBlock = BLOCK_ELEMENTS.has(name)
    if (isBlock) output.push('\n\n')
    appendReadableText(element, output)
    if (isBlock) output.push('\n\n')
  }
}

function extractChapterText(source: string): string {
  const document = parseXml(source)
  for (const name of ['script', 'style', 'nav']) {
    for (const element of elementsNamed(document, name)) element.remove()
  }
  const body = elementsNamed(document, 'body')[0] ?? document.documentElement
  const output: string[] = []
  appendReadableText(body, output)
  return output.join('')
    .replace(/[\t\f\v ]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{2,}/gu, '\n\n')
    .trim()
}

export async function extractEpubText(
  data: ArrayBuffer,
  filename = '',
  budgetOverrides: Partial<EpubBudgets> = {},
): Promise<EpubExtractionResult> {
  let metadata: Partial<Pick<EpubExtractionMeta, 'title' | 'author'>> = {}
  try {
    const budgets = validateBudgets(budgetOverrides)
    const zip = await JSZip.loadAsync(data)
    preflightArchive(zip, budgets)
    const inflationState: InflationState = { emittedBytes: 0, budgets }
    if (await readZipText(zip, 'mimetype', inflationState) !== EPUB_MIMETYPE) throw new Error('Wrong EPUB mimetype')

    const packagePath = containerPackagePath(await readZipText(zip, 'META-INF/container.xml', inflationState))
    const details = parsePackage(await readZipText(zip, packagePath, inflationState), packagePath, budgets)
    for (const item of details.spineItems) {
      if (!findZipFile(zip, item.href)) throw new Error(`Missing spine entry: ${item.href}`)
    }
    if (await hasDrmProtection(zip, details.manifestByPath, inflationState)) {
      return unsupported(DRM_REASON, emptyMeta())
    }

    const fallbackTitle = filename ? titleFromFilename(filename) : undefined
    metadata = {
      ...(details.title || fallbackTitle ? { title: details.title ?? fallbackTitle } : {}),
      ...(details.author ? { author: details.author } : {}),
    }
    const fixedCount = details.spineItems.filter(item => item.fixedLayout).length
    if (fixedCount / details.spineItems.length > 0.5) {
      return unsupported(FIXED_LAYOUT_REASON, emptyMeta(metadata))
    }

    const chapterOffsets: number[] = []
    let text = ''
    let charCount = 0
    for (const item of details.spineItems) {
      const source = await readZipText(zip, item.href, inflationState)
      const chapter = extractChapterText(source)
      if (!chapter) continue
      const separator = chapterOffsets.length ? '\n\n' : ''
      if (charCount + separator.length + chapter.length > MAX_EPUB_CHARACTERS) {
        return unsupported(CHARACTER_LIMIT_REASON, {
          ...metadata,
          chapterCount: chapterOffsets.length,
          charCount,
          chapterOffsets,
        })
      }
      charCount += separator.length
      chapterOffsets.push(charCount)
      text += separator + chapter
      charCount += chapter.length
    }

    if (!chapterOffsets.length) return unsupported(EMPTY_REASON, emptyMeta(metadata))
    const meta = { ...metadata, chapterCount: chapterOffsets.length, charCount, chapterOffsets }
    if (hasMostlyGarbageText(text)) return unsupported(GARBAGE_REASON, meta)
    return { status: 'ready', text, meta }
  } catch (error) {
    return unsupported(error instanceof EpubRefusal ? error.reason : INVALID_EPUB_REASON, emptyMeta(metadata))
  }
}
