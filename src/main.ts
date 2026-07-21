import {
  CreateStartUpPageContainer,
  OsEventTypeList,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import aliceText from '../books/alice-ch1-2.txt?raw'
import { createBookStore, type Book } from './book-store'
import {
  importRefreshFailureMessage,
  importSuccessMessage,
  removalRefreshFailureMessage,
  removalSuccessMessage,
  startupStorageNotice,
} from './companion-status'
import { importBookFile } from './file-import'
import { extractEpubText } from './epub-extract'
import { classifyInput } from './input'
import { libraryBody, libraryFooter, moveLibrarySelection, visibleLibraryBooks } from './library'
import { createLibraryRefreshCoordinator } from './library-refresh'
import { stageActiveBookPageCache } from './page-cache'
import { paginate } from './paginate'
import { extractPdfText } from './pdf-extract'
import { createPositionStore, remapPageIndex } from './position-store'
import {
  cycleDensity,
  cycleProgressStyle,
  menuBody,
  moveMenuSelection,
  progressFooter,
  readerLayout,
  resolveBootBookId,
  type Density,
  type ProgressStyle,
} from './reader-ui'
import {
  createConfirmedRenderSnapshot,
  persistConfirmedPosition,
  type ConfirmedRenderSnapshot,
} from './reader-runtime'
import { createRenderQueue } from './render-queue'
import { createSettingsStore } from './settings-store'
import { shouldSeedSimulatorBook } from './sim-seed'
import { initializeStartup } from './startup'
import { createUiCoordinator } from './ui-coordinator'

const ALICE_BOOK: Book = {
  id: 'alice-ch1-2',
  title: "Alice's Adventures in Wonderland (Ch. 1-2)",
  text: aliceText,
  source: 'bundled',
}

// Inner dimensions must match pretext measurement: LVGL subtracts both
// padding and border from every edge and uses a fixed 27px line height.
const BODY_W = 576
const LIBRARY_BODY_H = 240
const LIBRARY_FOOTER_Y = 246
const BODY_PAD = 4
const BODY_BORDER = 0
const INNER_W = BODY_W - 2 * (BODY_PAD + BODY_BORDER)

type Screen = 'library' | 'reader' | 'menu'
interface ReaderState {
  screen: Screen
  selectedBookIndex: number
  activeBookId: string
  pageIndex: number
  menuIndex: number
}
type ReaderRenderSnapshot = ConfirmedRenderSnapshot<ReaderState>

const bookStore = createBookStore()
const positionStore = createPositionStore()
const settingsStore = createSettingsStore()
if (import.meta.env.DEV && shouldSeedSimulatorBook(window.location.search, true)) {
  // Stale seed books from earlier harness runs persist in IndexedDB under
  // their old content hash; evict by title so exactly one seed book exists.
  const preSeed = await bookStore.list()
  for (const stale of preSeed.books.filter(b => b.title === 'G2 Simulator Seed')) {
    await bookStore.remove(stale.id)
  }
  // Every sentence is numbered so no two rendered pages are pixel-identical;
  // the harness pixel-diffs consecutive pages and repeated text defeats it.
  await bookStore.importText(
    'G2 Simulator Seed.txt',
    Array.from({ length: 55 }, (_, i) => `Simulator seed opening sentence ${i + 1}.`).join(' ') +
      '\n\n' +
      Array.from({ length: 55 }, (_, i) => `Simulator seed second passage sentence ${i + 1}.`).join(' '),
  )
}
const initialImportedBooks = await bookStore.list()
let books: Book[] = [ALICE_BOOK, ...initialImportedBooks.books]
let routedBooks: Book[] = books
let pageCache = new Map<string, string[]>()
let settings = settingsStore.read()
let density: Density = settings.density
let progressStyle: ProgressStyle = settings.progressStyle

function pagesFor(
  book: Book,
  targetDensity: Density = density,
  targetCache: Map<string, string[]> = pageCache,
): string[] {
  const cached = targetCache.get(book.id)
  if (cached) return cached
  const layout = readerLayout(targetDensity)
  const innerHeight = layout.bodyHeight - 2 * (layout.bodyPadding + BODY_BORDER)
  const pages = paginate(book.text, { width: INNER_W, height: innerHeight })
  const usable = pages.length ? pages : ['(empty)']
  targetCache.set(book.id, usable)
  return usable
}

function bookById(bookId: string, sourceBooks: readonly Book[] = routedBooks): Book {
  return sourceBooks.find(book => book.id === bookId) ?? ALICE_BOOK
}

function selectedBook(state: ReaderState, sourceBooks: readonly Book[] = routedBooks): Book {
  return visibleLibraryBooks(sourceBooks)[state.selectedBookIndex] ?? ALICE_BOOK
}

const bootBookId = resolveBootBookId(settings.lastActiveBookId, books.map(book => book.id))
const bootBook = bootBookId ? bookById(bootBookId) : ALICE_BOOK
const bootPages = pagesFor(bootBook)
const bootSelection = Math.max(0, visibleLibraryBooks(books).findIndex(book => book.id === bootBook.id))
let desiredState: ReaderState = {
  screen: bootBookId ? 'reader' : 'library',
  selectedBookIndex: bootSelection,
  activeBookId: bootBook.id,
  pageIndex: positionStore.restore(bootBook.id, bootPages.length, density),
  menuIndex: 0,
}
let renderedState: ReaderState | null = null

interface SnapshotContext {
  sourceBooks?: readonly Book[]
  targetCache?: Map<string, string[]>
  targetDensity?: Density
  targetProgressStyle?: ProgressStyle
}

function snapshotFor(state: ReaderState, context: SnapshotContext = {}): ReaderRenderSnapshot {
  const sourceBooks = context.sourceBooks ?? routedBooks
  const targetCache = context.targetCache ?? pageCache
  const targetDensity = context.targetDensity ?? density
  const targetProgressStyle = context.targetProgressStyle ?? progressStyle
  const book = state.screen === 'library'
    ? selectedBook(state, sourceBooks)
    : bookById(state.activeBookId, sourceBooks)
  const pages = pagesFor(book, targetDensity, targetCache)
  const body = state.screen === 'library'
    ? libraryBody(sourceBooks, state.selectedBookIndex)
    : state.screen === 'menu'
      ? menuBody(state.menuIndex, targetProgressStyle, targetDensity)
      : (pages[state.pageIndex] ?? '(empty)')
  const footer = state.screen === 'library'
    ? libraryFooter(sourceBooks.length)
    : progressFooter(targetProgressStyle, state.pageIndex, pages.length)

  return createConfirmedRenderSnapshot({
    state,
    body,
    footer,
    bookId: book.id,
    pageIndex: state.pageIndex,
    pageCount: pages.length,
    density: targetDensity,
    progressStyle: targetProgressStyle,
  })
}

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <main style="margin:auto;padding:24px;max-width:680px;box-sizing:border-box;">
    <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <h1 style="font-size:18px;font-weight:600;margin:0;">Readpane</h1>
      <span id="pageCount" style="font-size:12px;color:#919191;"></span>
    </header>
    <section style="background:#242424;border:1px solid #3E3E3E;border-radius:12px;padding:16px;margin-bottom:16px;">
      <label for="bookFile" style="display:block;font-size:13px;color:#E5E5E5;margin-bottom:8px;">Import a PDF, EPUB, or TXT file</label>
      <input id="bookFile" type="file" style="max-width:100%;color:#BDBDBD;" />
      <div id="importStatus" role="status" style="min-height:18px;font-size:12px;color:#AFAFAF;margin-top:8px;"></div>
      <div id="bookList" style="display:grid;gap:8px;margin-top:12px;"></div>
    </section>
    <pre id="mirror" style="background:#2E2E2E;border:1px solid #3E3E3E;border-radius:12px;padding:20px;font-size:15px;line-height:1.55;white-space:pre-wrap;word-break:break-word;color:#E5E5E5;margin:0;"></pre>
    <footer style="font-size:12px;color:#7B7B7B;text-align:center;margin-top:16px;">
      Glasses library: scroll to choose · tap to open · Reader: scroll pages · tap menu · double-tap exit
    </footer>
  </main>
`

const fileInput = document.querySelector<HTMLInputElement>('#bookFile')!
const importStatus = document.querySelector<HTMLDivElement>('#importStatus')!
const bookList = document.querySelector<HTMLDivElement>('#bookList')!

function setImportStatus(message: string, warnings: Array<'columns' | 'coverage'> = []) {
  importStatus.replaceChildren(document.createTextNode(message))
  for (const warning of warnings) {
    const badge = document.createElement('span')
    badge.textContent = warning === 'columns' ? ' Columns suspected' : ' Partial text coverage'
    badge.style.cssText = 'display:inline-block;margin-left:8px;padding:2px 6px;border:1px solid #A98B32;border-radius:999px;color:#D6B85A;'
    importStatus.appendChild(badge)
  }
}

function renderPhoneBookList() {
  bookList.replaceChildren()
  for (const book of books) {
    const row = document.createElement(book.source === 'imported' ? 'button' : 'div')
    row.style.cssText = 'box-sizing:border-box;width:100%;padding:10px 12px;border:1px solid #3E3E3E;border-radius:8px;background:#2E2E2E;color:#E5E5E5;text-align:left;font:inherit;'
    row.textContent = book.source === 'imported' ? `${book.title} · tap to remove` : `${book.title} · bundled`
    if (book.source === 'imported') {
      const button = row as HTMLButtonElement
      button.dataset.libraryMutation = 'true'
      button.disabled = uiCoordinator.pending
      button.addEventListener('click', () => {
        if (!window.confirm(`Remove “${book.title}” from the library?`)) return
        void uiCoordinator.runMutation(() => removeImportedBook(book)).catch(error => {
          setImportStatus(`Remove failed: ${error instanceof Error ? error.message : String(error)}`)
        })
      })
    }
    bookList.appendChild(row)
  }
}

function mirrorCompanion(snapshot: ReaderRenderSnapshot) {
  const state = snapshot.state
  const mirror = document.getElementById('mirror')
  const count = document.getElementById('pageCount')
  const book = state.screen === 'library' ? selectedBook(state) : bookById(snapshot.bookId)
  if (mirror) mirror.textContent = snapshot.body
  if (count) {
    count.textContent = state.screen === 'library'
      ? `Library · ${Math.min(routedBooks.length, 5)} shown`
      : state.screen === 'menu'
        ? `Reader menu · ${book.title}`
        : `${snapshot.pageIndex + 1} / ${snapshot.pageCount}`
  }
}

function logState(snapshot: ReaderRenderSnapshot) {
  const state = snapshot.state
  const book = state.screen === 'library' ? selectedBook(state) : bookById(snapshot.bookId)
  console.info(
    `G2_READER_STATE screen=${state.screen} selection=${state.selectedBookIndex + 1}/${Math.min(routedBooks.length, 5)} book=${book.id} page=${snapshot.pageIndex + 1}/${snapshot.pageCount} density=${snapshot.density} progress=${snapshot.progressStyle} menu=${state.menuIndex + 1}/4 bodyHeight=${state.screen === 'library' ? LIBRARY_BODY_H : readerLayout(snapshot.density).bodyHeight}`,
  )
}

const persistPosition = persistConfirmedPosition(positionStore)
function commitState(snapshot: ReaderRenderSnapshot) {
  const state = snapshot.state
  renderedState = { ...state }
  if (state.screen !== 'library') {
    persistPosition(snapshot)
    if (settings.lastActiveBookId !== state.activeBookId) {
      settingsStore.update({ lastActiveBookId: state.activeBookId })
      settings = settingsStore.read()
    }
  }
  mirrorCompanion(snapshot)
  logState(snapshot)
}

const bridge = await waitForEvenAppBridge()
let bridgeLane: Promise<unknown> = Promise.resolve()
function enqueueBridge<T>(operation: () => Promise<T>): Promise<T> {
  const next = bridgeLane.then(operation, operation)
  bridgeLane = next.then(() => undefined, () => undefined)
  return next
}

const renderQueue = createRenderQueue<ReaderRenderSnapshot>({
  writeBody: content => enqueueBridge(() => bridge.textContainerUpgrade(
    new TextContainerUpgrade({ containerID: 1, containerName: 'body', content }),
  )),
  writeFooter: content => enqueueBridge(() => bridge.textContainerUpgrade(
    new TextContainerUpgrade({ containerID: 2, containerName: 'pager', content }),
  )),
  onCommit: snapshot => {
    commitState(snapshot)
  },
})

const uiCoordinator = createUiCoordinator(pending => {
  fileInput.disabled = pending
  for (const control of bookList.querySelectorAll<HTMLButtonElement>('button[data-library-mutation]')) {
    control.disabled = pending
  }
})

function renderSnapshot(snapshot: ReaderRenderSnapshot) {
  return renderQueue.render({ body: snapshot.body, footer: snapshot.footer, state: snapshot })
}

function renderDesiredState() {
  return renderSnapshot(snapshotFor({ ...desiredState }))
}

function reportBridgeFailure(error: unknown) {
  console.error('G2_READER_BRIDGE_FAILED', error)
}

function makeBody(content: string, bodyHeight: number) {
  return new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: BODY_W,
    height: bodyHeight,
    borderWidth: BODY_BORDER,
    borderColor: 5,
    paddingLength: BODY_PAD,
    containerID: 1,
    containerName: 'body',
    content,
    isEventCapture: 1,
  })
}

function makePager(content: string, footerY: number) {
  return new TextContainerProperty({
    xPosition: 0,
    yPosition: footerY,
    width: 576,
    height: 288 - footerY,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 4,
    containerID: 2,
    containerName: 'pager',
    content,
    isEventCapture: 0,
  })
}

function libraryTarget(selectedIndex: number, sourceBooks: readonly Book[] = routedBooks) {
  const visibleCount = Math.max(1, Math.min(sourceBooks.length, 5))
  const clampedSelection = Math.max(0, Math.min(visibleCount - 1, selectedIndex))
  const book = visibleLibraryBooks(sourceBooks)[clampedSelection] ?? ALICE_BOOK
  const pages = pagesFor(book)
  const target: ReaderState = {
    screen: 'library',
    selectedBookIndex: clampedSelection,
    activeBookId: book.id,
    pageIndex: positionStore.restore(book.id, pages.length, density),
    menuIndex: 0,
  }
  return { target, snapshot: snapshotFor(target, { sourceBooks }) }
}

async function displayStructural(snapshot: ReaderRenderSnapshot, bodyHeight: number, footerY: number) {
  await renderQueue.structural(() => enqueueBridge(() => bridge.rebuildPageContainer(
    new RebuildPageContainer({
      containerTotalNum: 2,
      textObject: [
        makeBody(snapshot.body, bodyHeight),
        makePager(snapshot.footer, footerY),
      ],
    }),
  )))
}

function restoreRouting(priorDesired: ReaderState) {
  desiredState = renderedState ? { ...renderedState } : { ...priorDesired }
}

interface PendingLibraryRefresh {
  books: Book[]
  target: ReaderState
  snapshot: ReaderRenderSnapshot
}

const libraryRefresh = createLibraryRefreshCoordinator<PendingLibraryRefresh>({
  publishCompanion: pending => {
    books = pending.books
    renderPhoneBookList()
  },
  displayStructural: pending => displayStructural(pending.snapshot, LIBRARY_BODY_H, LIBRARY_FOOTER_Y),
  commitRouting: pending => {
    routedBooks = pending.books
    desiredState = { ...pending.target }
    commitState(pending.snapshot)
  },
})

async function refreshImportedBooks(selectedBookId?: string) {
  const imported = await bookStore.list()
  const nextBooks = [ALICE_BOOK, ...imported.books]
  const visible = visibleLibraryBooks(nextBooks)
  const selectedIndex = selectedBookId ? Math.max(0, visible.findIndex(book => book.id === selectedBookId)) : 0
  const { target, snapshot } = libraryTarget(selectedIndex, nextBooks)
  await libraryRefresh.stage({ books: nextBooks, target, snapshot })
}

async function removeImportedBook(book: Book) {
  setImportStatus(`Removing ${book.title}…`)
  const removed = await bookStore.remove(book.id)
  pageCache.delete(book.id)
  try {
    await refreshImportedBooks()
  } catch (error) {
    setImportStatus(removalRefreshFailureMessage(book.title, removed.durability))
    reportBridgeFailure(error)
    return
  }
  setImportStatus(removalSuccessMessage(book.title, removed.durability))
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  if (!file) return
  setImportStatus(`Importing ${file.name}…`)
  void uiCoordinator.runMutation(async () => {
    const result = await importBookFile(file, {
      store: bookStore,
      extractEpub: extractEpubText,
      extractPdf: extractPdfText,
    })
    if (result.status === 'unsupported') {
      setImportStatus(result.reason)
      return
    }
    try {
      await refreshImportedBooks(result.book.id)
    } catch (error) {
      setImportStatus(importRefreshFailureMessage(result.book.title, result.durability), result.warnings)
      reportBridgeFailure(error)
      return
    }
    setImportStatus(importSuccessMessage(result.book.title, result.durability), result.warnings)
  }).catch(error => {
    setImportStatus(`Import failed: ${error instanceof Error ? error.message : String(error)}`)
  }).finally(() => {
    fileInput.value = ''
  })
})

function openReader() {
  const priorDesired = { ...desiredState }
  const book = selectedBook(priorDesired)
  const pages = pagesFor(book)
  const target: ReaderState = {
    screen: 'reader',
    selectedBookIndex: priorDesired.selectedBookIndex,
    activeBookId: book.id,
    pageIndex: positionStore.restore(book.id, pages.length, density),
    menuIndex: 0,
  }
  const snapshot = snapshotFor(target)
  const layout = readerLayout(density)
  return uiCoordinator.runTransition({
    display: () => displayStructural(snapshot, layout.bodyHeight, layout.footerY),
    commit: () => {
      desiredState = { ...target }
      commitState(snapshot)
    },
    rollback: () => { restoreRouting(priorDesired) },
  })
}

function moveSelection(delta: -1 | 1) {
  const selectedBookIndex = moveLibrarySelection(desiredState.selectedBookIndex, delta, routedBooks.length)
  if (selectedBookIndex === desiredState.selectedBookIndex) return
  const book = visibleLibraryBooks(routedBooks)[selectedBookIndex] ?? ALICE_BOOK
  const pages = pagesFor(book)
  desiredState = {
    screen: 'library',
    selectedBookIndex,
    activeBookId: book.id,
    pageIndex: positionStore.restore(book.id, pages.length, density),
    menuIndex: 0,
  }
  renderDesiredState().catch(reportBridgeFailure)
}

function stagedTextTransition(target: ReaderState) {
  const priorDesired = { ...desiredState }
  const snapshot = snapshotFor(target)
  return uiCoordinator.runTransition({
    display: async () => {
      const outcome = await renderSnapshot(snapshot)
      if (outcome !== 'committed') throw new Error('Screen transition was superseded')
    },
    commit: () => { desiredState = { ...target } },
    rollback: () => { restoreRouting(priorDesired) },
  })
}

function openMenu() {
  return stagedTextTransition({ ...desiredState, screen: 'menu', menuIndex: 0 })
}

function moveMenu(delta: -1 | 1) {
  const menuIndex = moveMenuSelection(desiredState.menuIndex, delta)
  if (menuIndex === desiredState.menuIndex) return
  desiredState = { ...desiredState, screen: 'menu', menuIndex }
  renderDesiredState().catch(reportBridgeFailure)
}

function continueReading() {
  return stagedTextTransition({ ...desiredState, screen: 'reader' })
}

function changeProgressStyle() {
  const priorDesired = { ...desiredState }
  const nextProgressStyle = cycleProgressStyle(progressStyle)
  const snapshot = snapshotFor(priorDesired, { targetProgressStyle: nextProgressStyle })
  return uiCoordinator.runTransition({
    display: async () => {
      const outcome = await renderSnapshot(snapshot)
      if (outcome !== 'committed') throw new Error('Progress update was superseded')
    },
    commit: () => {
      progressStyle = nextProgressStyle
      settingsStore.update({ progressStyle })
      settings = settingsStore.read()
    },
    rollback: () => { restoreRouting(priorDesired) },
  })
}

function changeDensity() {
  const priorDesired = { ...desiredState }
  const book = bookById(priorDesired.activeBookId)
  const oldPages = pagesFor(book)
  const nextDensity = cycleDensity(density)
  // A novel-scale paginate is intentionally synchronous and can take around
  // two seconds. Stage only the active book; other books lazily rebuild on
  // their next pagesFor call, where stored density preserves progress remap.
  const stagedPageCache = stageActiveBookPageCache(book, nextDensity, pagesFor)
  const newPages = pagesFor(book, nextDensity, stagedPageCache)
  const target: ReaderState = {
    ...priorDesired,
    screen: 'menu',
    pageIndex: remapPageIndex(priorDesired.pageIndex, oldPages.length, newPages.length),
  }
  const snapshot = snapshotFor(target, { targetCache: stagedPageCache, targetDensity: nextDensity })
  const layout = readerLayout(nextDensity)

  return uiCoordinator.runTransition({
    display: () => displayStructural(snapshot, layout.bodyHeight, layout.footerY),
    commit: () => {
      density = nextDensity
      pageCache = stagedPageCache
      desiredState = { ...target }
      settingsStore.update({ density: nextDensity })
      settings = settingsStore.read()
      commitState(snapshot)
    },
    rollback: () => { restoreRouting(priorDesired) },
  })
}

function returnToLibrary() {
  const priorDesired = { ...desiredState }
  const selectedIndex = Math.max(
    0,
    visibleLibraryBooks(routedBooks).findIndex(book => book.id === priorDesired.activeBookId),
  )
  const { target, snapshot } = libraryTarget(selectedIndex)
  return uiCoordinator.runTransition({
    display: () => displayStructural(snapshot, LIBRARY_BODY_H, LIBRARY_FOOTER_Y),
    commit: () => {
      desiredState = { ...target }
      commitState(snapshot)
    },
    rollback: () => { restoreRouting(priorDesired) },
  })
}

function activateMenuItem() {
  const operation = desiredState.menuIndex === 0
    ? continueReading()
    : desiredState.menuIndex === 1
      ? changeProgressStyle()
      : desiredState.menuIndex === 2
        ? changeDensity()
        : returnToLibrary()
  operation.catch(reportBridgeFailure)
}

function navigate(delta: -1 | 1) {
  const book = bookById(desiredState.activeBookId)
  const pages = pagesFor(book)
  const target = desiredState.pageIndex + delta
  if (target >= 0 && target < pages.length) {
    desiredState = { ...desiredState, screen: 'reader', pageIndex: target }
    renderDesiredState().catch(reportBridgeFailure)
    return
  }

  // A failed render leaves desired state ahead of rendered state. A boundary
  // gesture then becomes an explicit retry of that still-unconfirmed page.
  if (
    renderedState?.screen !== 'reader' ||
    renderedState.pageIndex !== desiredState.pageIndex ||
    renderedState.activeBookId !== desiredState.activeBookId
  ) {
    renderDesiredState().catch(reportBridgeFailure)
  }
}

let cleanedUp = false
let unsubscribe: (() => void) | null = null
function cleanup() {
  if (cleanedUp) return
  cleanedUp = true
  unsubscribe?.()
  unsubscribe = null
}

function routeClassifiedInput(classified: ReturnType<typeof classifyInput>) {
  if (classified.kind === 'lifecycle') {
    if (
      classified.type === OsEventTypeList.SYSTEM_EXIT_EVENT ||
      classified.type === OsEventTypeList.ABNORMAL_EXIT_EVENT
    ) {
      renderQueue.confirmHostExit()
      cleanup()
      return
    }

    if (
      classified.type === OsEventTypeList.FOREGROUND_ENTER_EVENT &&
      (desiredState.screen === 'reader' || desiredState.screen === 'menu') &&
      !uiCoordinator.pending
    ) {
      const book = bookById(desiredState.activeBookId)
      const pages = pagesFor(book)
      desiredState = {
        ...desiredState,
        pageIndex: positionStore.restore(book.id, pages.length, density),
      }
      renderDesiredState().catch(reportBridgeFailure)
    }
    return
  }

  if (classified.kind !== 'user') return
  if (classified.action === 'exit') {
    if (renderQueue.exitPending) return
    renderQueue.requestShutdown(() => enqueueBridge(() => bridge.shutDownPageContainer(1))).catch(reportBridgeFailure)
    return
  }
  if (renderQueue.exitPending) return
  if (uiCoordinator.pending) return

  if (desiredState.screen === 'library') {
    if (classified.action === 'click') openReader().catch(reportBridgeFailure)
    else if (classified.action === 'up') moveSelection(-1)
    else if (classified.action === 'down') moveSelection(1)
    return
  }

  if (desiredState.screen === 'menu') {
    if (classified.action === 'click') activateMenuItem()
    else if (classified.action === 'up') moveMenu(-1)
    else if (classified.action === 'down') moveMenu(1)
    return
  }

  if (classified.action === 'click') openMenu().catch(reportBridgeFailure)
  else if (classified.action === 'up') navigate(-1)
  else if (classified.action === 'down') navigate(1)
}

function subscribeToInput() {
  return bridge.onEvenHubEvent(event => {
    const classified = classifyInput(event)
    const isHostExit = classified.kind === 'lifecycle' && (
      classified.type === OsEventTypeList.SYSTEM_EXIT_EVENT ||
      classified.type === OsEventTypeList.ABNORMAL_EXIT_EVENT
    )
    const triggersRefreshRetry = classified.kind === 'user' || (
      classified.kind === 'lifecycle' && classified.type === OsEventTypeList.FOREGROUND_ENTER_EVENT
    )

    if (!isHostExit && triggersRefreshRetry && libraryRefresh.pending) {
      if (uiCoordinator.pending) return
      void uiCoordinator.runMutation(async () => {
        if (await libraryRefresh.retry()) routeClassifiedInput(classified)
      }).catch(reportBridgeFailure)
      return
    }

    routeClassifiedInput(classified)
  })
}

window.addEventListener('beforeunload', cleanup)
renderPhoneBookList()
const storageNotice = startupStorageNotice(initialImportedBooks)
if (storageNotice) setImportStatus(storageNotice)

const initialBook = desiredState.screen === 'library' ? selectedBook(desiredState) : bookById(desiredState.activeBookId)
const initialSnapshot = snapshotFor(desiredState)
const initialLayout = desiredState.screen === 'library'
  ? { bodyHeight: LIBRARY_BODY_H, footerY: LIBRARY_FOOTER_Y }
  : readerLayout(density)
const body = makeBody(initialSnapshot.body, initialLayout.bodyHeight)
const pager = makePager(initialSnapshot.footer, initialLayout.footerY)

// SDK 0.0.12's required call order places general event listeners after the
// one-shot startup container succeeds. Subscribing before this await would
// violate that contract, so failed startup deliberately installs no router.
unsubscribe = await initializeStartup({
  create: () => enqueueBridge(() => bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({ containerTotalNum: 2, textObject: [body, pager] }),
  )),
  subscribe: subscribeToInput,
  onReady: () => {
    commitState(initialSnapshot)
    console.info(
      `G2_READER_READY screen=${desiredState.screen} selection=${desiredState.selectedBookIndex + 1}/${Math.min(routedBooks.length, 5)} book=${initialBook.id} page=${initialSnapshot.pageIndex + 1}/${initialSnapshot.pageCount} density=${initialSnapshot.density} progress=${initialSnapshot.progressStyle}`,
    )
  },
  onFailed: reason => {
    console.error('G2_READER_FAILED', reason)
  },
})
