import {
  CreateStartUpPageContainer,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import aliceText from '../books/alice-ch1-2.txt?raw'
import { classifyInput } from './input'
import { paginate } from './paginate'
import { createPositionStore } from './position-store'
import { createRenderQueue } from './render-queue'
import { initializeStartup } from './startup'

const BOOK_ID = 'alice-ch1-2'
const BOOK_TITLE = "Alice's Adventures in Wonderland (Ch. 1-2)"

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
  pageIndex: number
}

const pages = paginate(aliceText, { width: INNER_W, height: INNER_H })
const positionStore = createPositionStore()
let desiredState: ReaderState = {
  screen: 'library',
  pageIndex: positionStore.restore(BOOK_ID, pages.length),
}
let renderedState: ReaderState | null = null

function libraryBody() {
  return `LIBRARY\n\n> ${BOOK_TITLE}`
}

function libraryFooter() {
  return 'tap: open  ·  double-tap: exit'
}

function pagerLabel(pageIndex: number) {
  return `${pageIndex + 1} / ${pages.length}  ·  tap/down: next  ·  up: prev  ·  double: exit`
}

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <main style="margin:auto;padding:24px;max-width:680px;box-sizing:border-box;">
    <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <h1 style="font-size:18px;font-weight:600;margin:0;">G2 Reader</h1>
      <span id="pageCount" style="font-size:12px;color:#919191;"></span>
    </header>
    <pre id="mirror" style="background:#2E2E2E;border:1px solid #3E3E3E;border-radius:12px;padding:20px;font-size:15px;line-height:1.55;white-space:pre-wrap;word-break:break-word;color:#E5E5E5;margin:0;"></pre>
    <footer style="font-size:12px;color:#7B7B7B;text-align:center;margin-top:16px;">
      Glasses start in the library · tap to open · tap/down next · up previous · double-tap exit
    </footer>
  </main>
`

function mirrorCompanion(state: ReaderState) {
  const mirror = document.getElementById('mirror')
  const count = document.getElementById('pageCount')
  if (mirror) mirror.textContent = state.screen === 'library' ? libraryBody() : (pages[state.pageIndex] ?? '')
  if (count) count.textContent = state.screen === 'library' ? 'Library' : `${state.pageIndex + 1} / ${pages.length}`
}

function logState(state: ReaderState) {
  console.info(`G2_READER_STATE screen=${state.screen} page=${state.pageIndex + 1}/${pages.length}`)
}

const bridge = await waitForEvenAppBridge()
const renderQueue = createRenderQueue<ReaderState>({
  writeBody: content => bridge.textContainerUpgrade(
    new TextContainerUpgrade({ containerID: 1, containerName: 'body', content }),
  ),
  writeFooter: content => bridge.textContainerUpgrade(
    new TextContainerUpgrade({ containerID: 2, containerName: 'pager', content }),
  ),
  onCommit: state => {
    renderedState = state
    if (state.screen === 'reader') positionStore.save(BOOK_ID, state.pageIndex, pages.length)
    mirrorCompanion(state)
    logState(state)
  },
})

function renderDesiredState() {
  const state = { ...desiredState }
  const bodyContent = state.screen === 'library' ? libraryBody() : (pages[state.pageIndex] ?? '(empty)')
  const footerContent = state.screen === 'library' ? libraryFooter() : pagerLabel(state.pageIndex)
  return renderQueue.render({ body: bodyContent, footer: footerContent, state })
}

function reportBridgeFailure(error: unknown) {
  console.error('G2_READER_BRIDGE_FAILED', error)
}

function openReader() {
  desiredState = { screen: 'reader', pageIndex: desiredState.pageIndex }
  renderDesiredState().catch(reportBridgeFailure)
}

function navigate(delta: -1 | 1) {
  const target = desiredState.pageIndex + delta
  if (target >= 0 && target < pages.length) {
    desiredState = { screen: 'reader', pageIndex: target }
    renderDesiredState().catch(reportBridgeFailure)
    return
  }

  // A failed render leaves desired state ahead of rendered state. A boundary
  // gesture then becomes an explicit retry of that still-unconfirmed page.
  if (renderedState?.screen !== 'reader' || renderedState.pageIndex !== desiredState.pageIndex) {
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

      if (classified.type === OsEventTypeList.FOREGROUND_ENTER_EVENT && desiredState.screen === 'reader') {
        desiredState = {
          screen: 'reader',
          pageIndex: positionStore.restore(BOOK_ID, pages.length),
        }
        renderDesiredState().catch(reportBridgeFailure)
      }
      return
    }

    if (classified.kind !== 'user') return
    if (classified.action === 'exit') {
      renderQueue.requestShutdown(() => bridge.shutDownPageContainer(1)).catch(reportBridgeFailure)
      return
    }
    if (renderQueue.exitPending) return

    if (desiredState.screen === 'library') {
      if (event.sysEvent && classified.action === 'next') openReader()
      return
    }

    if (classified.action === 'prev') navigate(-1)
    else if (classified.action === 'next') navigate(1)
  })
}

window.addEventListener('beforeunload', cleanup)

const body = new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: BODY_W,
  height: BODY_H,
  borderWidth: BODY_BORDER,
  borderColor: 5,
  paddingLength: BODY_PAD,
  containerID: 1,
  containerName: 'body',
  content: libraryBody(),
  isEventCapture: 1,
})

const pager = new TextContainerProperty({
  xPosition: 0,
  yPosition: 246,
  width: 576,
  height: 42,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 4,
  containerID: 2,
  containerName: 'pager',
  content: libraryFooter(),
  isEventCapture: 0,
})

unsubscribe = await initializeStartup({
  create: () => bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({ containerTotalNum: 2, textObject: [body, pager] }),
  ),
  subscribe: subscribeToInput,
  onReady: () => {
    renderedState = { ...desiredState }
    mirrorCompanion(renderedState)
    console.info(`G2_READER_READY screen=library page=${renderedState.pageIndex + 1}/${pages.length}`)
  },
  onFailed: reason => {
    console.error('G2_READER_FAILED', reason)
  },
})
