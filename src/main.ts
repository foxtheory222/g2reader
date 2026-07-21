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
import { classifyInput } from './input'
import { libraryBody, libraryFooter, moveLibrarySelection, visibleLibraryBooks } from './library'
import { createMutationQueue } from './mutation-queue'
import { paginate } from './paginate'
import { extractPdfText } from './pdf-extract'
import { createPositionStore } from './position-store'
import { createRenderQueue } from './render-queue'
import { shouldSeedSimulatorBook } from './sim-seed'
import { initializeStartup } from './startup'

const ALICE_BOOK: Book = {
  id: 'alice-ch1-2',
  title: "Alice's Adventures in Wonderland (Ch. 1-2)",
  text: aliceText,
  source: 'bundled',
}

// Inner dimensions must match pretext measurement: LVGL subtracts both
// padding and border from every edge and uses a fixed 27px line height.
const BODY_W = 576
const BODY_H = 240
const BODY_PAD = 4
const BODY_BORDER = 0
const INNER_W = BODY_W - 2 * (BODY_PAD + BODY_BORDER)
const INNER_H = BODY_H - 2 * (BODY_PAD + BODY_BORDER)

type Screen = 'library' | 'reader'
interface ReaderState {
  screen: Screen
  selectedBookIndex: number
  activeBookId: string
  pageIndex: number
}

const bookStore = createBookStore()
const positionStore = createPositionStore()
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
const pageCache = new Map<string, string[]>()

function pagesFor(book: Book): string[] {
  const cached = pageCache.get(book.id)
  if (cached) return cached
  const pages = paginate(book.text, { width: INNER_W, height: INNER_H })
  const usable = pages.length ? pages : ['(empty)']
  pageCache.set(book.id, usable)
  return usable
}

function bookById(bookId: string): Book {
  return books.find(book => book.id === bookId) ?? ALICE_BOOK
}

function selectedBook(state: ReaderState): Book {
  return visibleLibraryBooks(books)[state.selectedBookIndex] ?? ALICE_BOOK
}

const alicePages = pagesFor(ALICE_BOOK)
let desiredState: ReaderState = {
  screen: 'library',
  selectedBookIndex: 0,
  activeBookId: ALICE_BOOK.id,
  pageIndex: positionStore.restore(ALICE_BOOK.id, alicePages.length),
}
let renderedState: ReaderState | null = null

function pagerLabel(book: Book, pageIndex: number) {
  const pages = pagesFor(book)
  return `${pageIndex + 1} / ${pages.length}  ·  tap/down: next  ·  up: prev  ·  double: exit`
}

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <main style="margin:auto;padding:24px;max-width:680px;box-sizing:border-box;">
    <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <h1 style="font-size:18px;font-weight:600;margin:0;">G2 Reader</h1>
      <span id="pageCount" style="font-size:12px;color:#919191;"></span>
    </header>
    <section style="background:#242424;border:1px solid #3E3E3E;border-radius:12px;padding:16px;margin-bottom:16px;">
      <label for="bookFile" style="display:block;font-size:13px;color:#E5E5E5;margin-bottom:8px;">Import a PDF or TXT file</label>
      <input id="bookFile" type="file" accept=".pdf,.txt,application/pdf,text/plain" style="max-width:100%;color:#BDBDBD;" />
      <div id="importStatus" role="status" style="min-height:18px;font-size:12px;color:#AFAFAF;margin-top:8px;"></div>
      <div id="bookList" style="display:grid;gap:8px;margin-top:12px;"></div>
    </section>
    <pre id="mirror" style="background:#2E2E2E;border:1px solid #3E3E3E;border-radius:12px;padding:20px;font-size:15px;line-height:1.55;white-space:pre-wrap;word-break:break-word;color:#E5E5E5;margin:0;"></pre>
    <footer style="font-size:12px;color:#7B7B7B;text-align:center;margin-top:16px;">
      Glasses start in the library · scroll to choose · tap to open · tap/down next · up previous · double-tap exit
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
      button.disabled = libraryMutationPending
      button.addEventListener('click', () => {
        if (!window.confirm(`Remove “${book.title}” from the library?`)) return
        void libraryMutationQueue.enqueue(() => removeImportedBook(book)).catch(error => {
          setImportStatus(`Remove failed: ${error instanceof Error ? error.message : String(error)}`)
        })
      })
    }
    bookList.appendChild(row)
  }
}

function mirrorCompanion(state: ReaderState) {
  const mirror = document.getElementById('mirror')
  const count = document.getElementById('pageCount')
  const book = state.screen === 'library' ? selectedBook(state) : bookById(state.activeBookId)
  const pages = pagesFor(book)
  if (mirror) mirror.textContent = state.screen === 'library' ? libraryBody(books, state.selectedBookIndex) : (pages[state.pageIndex] ?? '')
  if (count) count.textContent = state.screen === 'library' ? `Library · ${Math.min(books.length, 5)} shown` : `${state.pageIndex + 1} / ${pages.length}`
}

function logState(state: ReaderState) {
  const book = state.screen === 'library' ? selectedBook(state) : bookById(state.activeBookId)
  const pages = pagesFor(book)
  console.info(
    `G2_READER_STATE screen=${state.screen} selection=${state.selectedBookIndex + 1}/${Math.min(books.length, 5)} book=${book.id} page=${state.pageIndex + 1}/${pages.length}`,
  )
}

const bridge = await waitForEvenAppBridge()
let bridgeLane: Promise<unknown> = Promise.resolve()
function enqueueBridge<T>(operation: () => Promise<T>): Promise<T> {
  const next = bridgeLane.then(operation, operation)
  bridgeLane = next.then(() => undefined, () => undefined)
  return next
}

const renderQueue = createRenderQueue<ReaderState>({
  writeBody: content => enqueueBridge(() => bridge.textContainerUpgrade(
    new TextContainerUpgrade({ containerID: 1, containerName: 'body', content }),
  )),
  writeFooter: content => enqueueBridge(() => bridge.textContainerUpgrade(
    new TextContainerUpgrade({ containerID: 2, containerName: 'pager', content }),
  )),
  onCommit: state => {
    renderedState = state
    if (state.screen === 'reader') {
      const pages = pagesFor(bookById(state.activeBookId))
      positionStore.save(state.activeBookId, state.pageIndex, pages.length)
    }
    mirrorCompanion(state)
    logState(state)
  },
})

let libraryMutationPending = false
const libraryMutationQueue = createMutationQueue(pending => {
  libraryMutationPending = pending
  fileInput.disabled = pending
  for (const control of bookList.querySelectorAll<HTMLButtonElement>('button[data-library-mutation]')) {
    control.disabled = pending
  }
})

function renderDesiredState() {
  const state = { ...desiredState }
  const book = state.screen === 'library' ? selectedBook(state) : bookById(state.activeBookId)
  const pages = pagesFor(book)
  const bodyContent = state.screen === 'library' ? libraryBody(books, state.selectedBookIndex) : (pages[state.pageIndex] ?? '(empty)')
  const footerContent = state.screen === 'library' ? libraryFooter(books.length) : pagerLabel(book, state.pageIndex)
  return renderQueue.render({ body: bodyContent, footer: footerContent, state })
}

function reportBridgeFailure(error: unknown) {
  console.error('G2_READER_BRIDGE_FAILED', error)
}

function makeBody(content: string) {
  return new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: BODY_W,
    height: BODY_H,
    borderWidth: BODY_BORDER,
    borderColor: 5,
    paddingLength: BODY_PAD,
    containerID: 1,
    containerName: 'body',
    content,
    isEventCapture: 1,
  })
}

function makePager(content: string) {
  return new TextContainerProperty({
    xPosition: 0,
    yPosition: 246,
    width: 576,
    height: 42,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 4,
    containerID: 2,
    containerName: 'pager',
    content,
    isEventCapture: 0,
  })
}

async function rebuildLibrary(selectedIndex: number) {
  const visibleCount = Math.max(1, Math.min(books.length, 5))
  const clampedSelection = Math.max(0, Math.min(visibleCount - 1, selectedIndex))
  const book = visibleLibraryBooks(books)[clampedSelection] ?? ALICE_BOOK
  const pages = pagesFor(book)
  desiredState = {
    screen: 'library',
    selectedBookIndex: clampedSelection,
    activeBookId: book.id,
    pageIndex: positionStore.restore(book.id, pages.length),
  }
  await renderQueue.structural(() => enqueueBridge(() => bridge.rebuildPageContainer(
    new RebuildPageContainer({
      containerTotalNum: 2,
      textObject: [makeBody(libraryBody(books, clampedSelection)), makePager(libraryFooter(books.length))],
    }),
  )))
  renderedState = { ...desiredState }
  mirrorCompanion(renderedState)
  logState(renderedState)
}

async function refreshImportedBooks(selectedBookId?: string) {
  const imported = await bookStore.list()
  books = [ALICE_BOOK, ...imported.books]
  const visible = visibleLibraryBooks(books)
  const selectedIndex = selectedBookId ? Math.max(0, visible.findIndex(book => book.id === selectedBookId)) : 0
  renderPhoneBookList()
  await rebuildLibrary(selectedIndex)
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
  void libraryMutationQueue.enqueue(async () => {
    const result = await importBookFile(file, { store: bookStore, extractPdf: extractPdfText })
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
  const book = selectedBook(desiredState)
  const pages = pagesFor(book)
  desiredState = {
    screen: 'reader',
    selectedBookIndex: desiredState.selectedBookIndex,
    activeBookId: book.id,
    pageIndex: positionStore.restore(book.id, pages.length),
  }
  renderDesiredState().catch(reportBridgeFailure)
}

function moveSelection(delta: -1 | 1) {
  const selectedBookIndex = moveLibrarySelection(desiredState.selectedBookIndex, delta, books.length)
  if (selectedBookIndex === desiredState.selectedBookIndex) return
  const book = visibleLibraryBooks(books)[selectedBookIndex] ?? ALICE_BOOK
  const pages = pagesFor(book)
  desiredState = {
    screen: 'library',
    selectedBookIndex,
    activeBookId: book.id,
    pageIndex: positionStore.restore(book.id, pages.length),
  }
  renderDesiredState().catch(reportBridgeFailure)
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

function subscribeToInput() {
  return bridge.onEvenHubEvent(event => {
    const classified = classifyInput(event)

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
        desiredState.screen === 'reader' &&
        !libraryMutationPending
      ) {
        const book = bookById(desiredState.activeBookId)
        const pages = pagesFor(book)
        desiredState = {
          ...desiredState,
          screen: 'reader',
          pageIndex: positionStore.restore(book.id, pages.length),
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
    if (libraryMutationPending) return

    if (desiredState.screen === 'library') {
      if (event.sysEvent && classified.action === 'next') openReader()
      else if (classified.action === 'prev') moveSelection(-1)
      else if (classified.action === 'next') moveSelection(1)
      return
    }

    if (classified.action === 'prev') navigate(-1)
    else if (classified.action === 'next') navigate(1)
  })
}

window.addEventListener('beforeunload', cleanup)
renderPhoneBookList()
const storageNotice = startupStorageNotice(initialImportedBooks)
if (storageNotice) setImportStatus(storageNotice)

const body = makeBody(libraryBody(books, desiredState.selectedBookIndex))
const pager = makePager(libraryFooter(books.length))

// SDK 0.0.12's required call order places general event listeners after the
// one-shot startup container succeeds. Subscribing before this await would
// violate that contract, so failed startup deliberately installs no router.
unsubscribe = await initializeStartup({
  create: () => enqueueBridge(() => bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({ containerTotalNum: 2, textObject: [body, pager] }),
  )),
  subscribe: subscribeToInput,
  onReady: () => {
    renderedState = { ...desiredState }
    mirrorCompanion(renderedState)
    const pages = pagesFor(ALICE_BOOK)
    console.info(
      `G2_READER_READY screen=library selection=${renderedState.selectedBookIndex + 1}/${Math.min(books.length, 5)} page=${positionStore.restore(ALICE_BOOK.id, pages.length) + 1}/${pages.length}`,
    )
  },
  onFailed: reason => {
    console.error('G2_READER_FAILED', reason)
  },
})
