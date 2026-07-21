import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  assertRequiredPortsFree,
  decodeRgbaPng,
  findSeriousConsoleEntries,
  pixelDifferenceRegion,
  simulatorLaunchUrl,
  screenshotsMatchPixels,
  stopAll,
  waitForChildReadiness,
} from './test-sim-lib.mjs'

if (Number(process.versions.node.split('.')[0]) < 20) {
  throw new Error('test:sim requires Node.js 20 or newer')
}

const initialAppUrl = simulatorLaunchUrl(true)
const automationUrl = 'http://127.0.0.1:9898'
const evidenceDir = new URL('../evidence/', import.meta.url)
const BODY_START_Y = 0
const DEFAULT_BODY_END_Y = 170
const COMPACT_FOOTER_START_Y = 230
const FOOTER_END_Y = 288
const children = new Set()
// No simulator console noise is allowlisted. Additions require a reproduced,
// narrowly documented simulator-only reason rather than a broad pattern.
const CONSOLE_ERROR_ALLOWLIST = []

function launch(command, args, label) {
  const child = spawn(command, args, {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.add(child)
  child.stdout.on('data', chunk => process.stdout.write(`[${label}] ${chunk}`))
  child.stderr.on('data', chunk => process.stderr.write(`[${label}] ${chunk}`))
  child.earlyFailure = new Promise(resolve => {
    child.once('error', error => resolve(new Error(`${label} failed to spawn: ${error}`)))
    child.once('exit', (code, signal) => {
      resolve(new Error(`${label} exited before readiness (code=${code}, signal=${signal})`))
    })
  })
  return child
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

async function waitFor(check, description, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const value = await check()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await delay(250)
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError}` : ''}`)
}

async function waitForChild(child, check, description, timeoutMs = 30_000) {
  return waitForChildReadiness(waitFor(check, description, timeoutMs), child.earlyFailure)
}

async function get(path) {
  const response = await fetch(`${automationUrl}${path}`, { signal: AbortSignal.timeout(2_000) })
  if (!response.ok) throw new Error(`${path} returned ${response.status}`)
  return response
}

async function consoleEntries() {
  const body = await (await get('/api/console')).json()
  return Array.isArray(body.entries) ? body.entries : []
}

async function waitForConsole(text, child) {
  return waitForChild(child, async () => {
    const entry = (await consoleEntries()).find(entry => String(entry.message).includes(text))
    return entry ? String(entry.message) : false
  }, `console entry containing ${JSON.stringify(text)}`)
}

async function assertConsoleHealthy(context) {
  const failures = findSeriousConsoleEntries(await consoleEntries(), CONSOLE_ERROR_ALLOWLIST)
  if (failures.length) {
    throw new Error(`${context} emitted serious console entries: ${JSON.stringify(failures)}`)
  }
}

async function clearConsole() {
  const response = await fetch(`${automationUrl}/api/console`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(2_000),
  })
  if (!response.ok) throw new Error(`clearing console returned ${response.status}`)
}

async function inject(action) {
  const response = await fetch(`${automationUrl}/api/input`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
    signal: AbortSignal.timeout(2_000),
  })
  if (!response.ok) throw new Error(`input ${action} returned ${response.status}`)
  const body = await response.json()
  if (!body.ok) throw new Error(`input ${action} was not accepted`)
}

async function performAction(child, action, expectedLog) {
  await clearConsole()
  await inject(action)
  const message = await waitForConsole(expectedLog, child)
  await assertConsoleHealthy(`input ${action}`)
  return message
}

async function screenshot(name) {
  const bytes = Buffer.from(await (await get('/api/screenshot/glasses')).arrayBuffer())
  // Decoding validates the 576x288 RGBA contract even for a one-off capture.
  pixelDifferenceRegion(bytes, bytes, BODY_START_Y, FOOTER_END_Y)
  await writeFile(new URL(name, evidenceDir), bytes)
  return bytes
}

async function screenshotUntilStable(name, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  let previous
  while (Date.now() < deadline) {
    const current = Buffer.from(await (await get('/api/screenshot/glasses')).arrayBuffer())
    if (previous && screenshotsMatchPixels(previous, current)) {
      await writeFile(new URL(name, evidenceDir), current)
      return current
    }
    previous = current
    await delay(200)
  }
  throw new Error(`Timed out waiting for stable screenshot ${JSON.stringify(name)}`)
}

function litPixelsInRegion(png, yStart, yEnd) {
  const { pixels, width } = decodeRgbaPng(png)
  let lit = 0
  for (let y = yStart; y < yEnd; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] > 0) lit++
    }
  }
  return lit
}

async function stop(child) {
  if (!child?.pid) return

  const signalGroup = signal => {
    try {
      process.kill(-child.pid, signal)
      return true
    } catch (error) {
      if (error?.code === 'ESRCH') return false
      throw error
    }
  }
  const groupIsAlive = () => signalGroup(0)

  if (!signalGroup('SIGTERM')) {
    children.delete(child)
    return
  }

  const deadline = Date.now() + 3_000
  while (Date.now() < deadline && groupIsAlive()) await delay(100)
  if (groupIsAlive()) {
    signalGroup('SIGKILL')
    await waitFor(() => !groupIsAlive(), `process group ${child.pid} to stop`, 2_000)
  }
  children.delete(child)
}

let cleanupPromise
function cleanupAll() {
  cleanupPromise ??= stopAll([...children].map(child => () => stop(child)))
  return cleanupPromise
}

for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => {
    cleanupAll().then(
      () => process.exit(exitCode),
      error => {
        console.error(error)
        process.exit(1)
      },
    )
  })
}

function portIsOpen(host, port) {
  return new Promise(resolve => {
    const socket = createConnection({ host, port })
    const finish = result => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(750, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

async function assertPortFree(port, label) {
  if (await portIsOpen('127.0.0.1', port)) {
    throw new Error(`Refusing to start: ${label} port ${port} is already in use`)
  }
}

async function launchSimulator(seedBook) {
  await assertPortFree(9898, 'simulator automation')
  const appUrl = simulatorLaunchUrl(seedBook)
  const simulator = launch(
    'node_modules/.bin/evenhub-simulator',
    [appUrl, '--automation-port', '9898'],
    'simulator',
  )
  await waitForChild(
    simulator,
    async () => (await (await get('/api/ping')).text()) === 'pong',
    'simulator API',
  )
  const readyMessage = await waitForConsole('G2_READER_READY screen=', simulator)
  await assertConsoleHealthy('application readiness')
  const match = readyMessage.match(/screen=(library|reader) selection=(\d+)\/(\d+) book=([^ ]+) page=(\d+)\/(\d+) density=(5|6|8) progress=(percent|page|hidden)/)
  if (!match) throw new Error(`Could not parse ready log: ${readyMessage}`)
  if (seedBook && Number(match[3]) !== 2) {
    throw new Error(`Seeded launch did not expose exactly two books: ${readyMessage}`)
  }
  return {
    child: simulator,
    screen: match[1],
    selection: Number(match[2]),
    bookCount: Number(match[3]),
    bookId: match[4],
    page: Number(match[5]),
    pageCount: Number(match[6]),
    density: Number(match[7]),
    progress: match[8],
    message: readyMessage,
  }
}

async function moveMenuCursor(child, from, to) {
  let cursor = from
  while (cursor < to) {
    cursor++
    await performAction(child, 'down', `screen=menu`)
  }
  while (cursor > to) {
    cursor--
    await performAction(child, 'up', `screen=menu`)
  }
  return cursor
}

async function normalizeReader(child, state) {
  let current = state
  if (current.screen === 'reader') {
    await performAction(child, 'click', 'screen=menu')
    await moveMenuCursor(child, 1, 4)
    const libraryMessage = await performAction(child, 'click', 'screen=library')
    const match = libraryMessage.match(/selection=(\d+)\/(\d+) book=([^ ]+)/)
    if (!match) throw new Error(`Could not parse library state: ${libraryMessage}`)
    current = { ...current, screen: 'library', selection: Number(match[1]), bookId: match[3] }
  }

  let seedId = current.selection === 2 ? current.bookId : null
  if (current.selection !== 2) {
    const selectionMessage = await performAction(child, 'down', 'screen=library selection=2/2 book=')
    seedId = selectionMessage.match(/book=(book-[0-9a-f]{64})/)?.[1] ?? null
  }
  if (!seedId?.startsWith('book-')) throw new Error(`Could not resolve deterministic seed id from ${JSON.stringify(current)}`)

  let message = await performAction(child, 'click', `screen=reader selection=2/2 book=${seedId}`)
  await performAction(child, 'click', 'screen=menu')
  let cursor = await moveMenuCursor(child, 1, 2)
  let progress = message.match(/progress=(percent|page|hidden)/)?.[1] ?? current.progress
  while (progress !== 'percent') {
    message = await performAction(child, 'click', 'screen=menu')
    progress = message.match(/progress=(percent|page|hidden)/)?.[1]
  }
  cursor = await moveMenuCursor(child, cursor, 3)
  let density = Number(message.match(/density=(5|6|8)/)?.[1] ?? current.density)
  while (density !== 6) {
    message = await performAction(child, 'click', 'screen=menu')
    density = Number(message.match(/density=(5|6|8)/)?.[1])
  }
  await moveMenuCursor(child, cursor, 1)
  message = await performAction(child, 'click', `screen=reader selection=2/2 book=${seedId}`)
  const pageMatch = message.match(/page=(\d+)\/(\d+)/)
  if (!pageMatch) throw new Error(`Could not parse normalized reader state: ${message}`)
  for (let page = Number(pageMatch[1]); page > 1; page--) {
    await performAction(child, 'up', `book=${seedId} page=${page - 1}/`)
  }
  return { seedId, pageCount: Number(pageMatch[2]) }
}

let preview
let simulator
try {
  await assertRequiredPortsFree(port => portIsOpen('127.0.0.1', port))
  await mkdir(evidenceDir, { recursive: true })
  preview = launch(
    'node_modules/.bin/vite',
    ['--host', '127.0.0.1', '--port', '4173', '--strictPort'],
    'dev',
  )
  await waitForChild(
    preview,
    async () => (await fetch(initialAppUrl, { signal: AbortSignal.timeout(2_000) })).ok,
    'Vite preview',
  )

  const initialLaunch = await launchSimulator(true)
  simulator = initialLaunch.child
  const normalized = await normalizeReader(simulator, initialLaunch)
  const { seedId } = normalized
  if (normalized.pageCount < 2) throw new Error(`Seeded book has only ${normalized.pageCount} pages at six lines`)
  const page1 = await screenshotUntilStable('01-reader-page-1-percent.png')

  // Footer cycle proof: tap opens the menu; Progress stays selected while its
  // value cycles percent -> page -> hidden, with the footer region changing.
  await performAction(simulator, 'click', `screen=menu selection=2/2 book=${seedId}`)
  await moveMenuCursor(simulator, 1, 2)
  const percentMenu = await screenshotUntilStable('02-menu-progress-percent.png')
  await performAction(simulator, 'click', 'screen=menu')
  const pageMenu = await screenshotUntilStable('03-menu-progress-page.png')
  const percentToPageFooterDiff = pixelDifferenceRegion(
    percentMenu, pageMenu, DEFAULT_BODY_END_Y, FOOTER_END_Y,
  )
  if (percentToPageFooterDiff === 0) throw new Error('Percent to page did not change the footer region')

  await performAction(simulator, 'click', 'progress=hidden menu=2/4')
  const hiddenMenu = await screenshotUntilStable('04-menu-progress-hidden.png')
  const pageToHiddenFooterDiff = pixelDifferenceRegion(
    pageMenu, hiddenMenu, DEFAULT_BODY_END_Y, FOOTER_END_Y,
  )
  if (pageToHiddenFooterDiff === 0) throw new Error('Page to hidden did not change the footer region')
  if (litPixelsInRegion(hiddenMenu, DEFAULT_BODY_END_Y, FOOTER_END_Y) !== 0) {
    throw new Error('Hidden progress left lit pixels in the footer region')
  }

  // Return to percent, then page so the density proof can observe the changed
  // page count in both the state marker and footer pixels.
  await performAction(simulator, 'click', 'progress=percent menu=2/4')
  const restoredPercentMenu = await screenshotUntilStable('05-menu-progress-percent-restored.png')
  if (pixelDifferenceRegion(hiddenMenu, restoredPercentMenu, DEFAULT_BODY_END_Y, FOOTER_END_Y) === 0) {
    throw new Error('Hidden to percent did not restore footer pixels')
  }
  const pageStyleMessage = await performAction(simulator, 'click', 'progress=page menu=2/4')
  const oldCount = Number(pageStyleMessage.match(/page=\d+\/(\d+)/)?.[1])
  await moveMenuCursor(simulator, 2, 3)
  const densitySixMenu = await screenshotUntilStable('06-menu-density-6.png')
  const densityMessage = await performAction(simulator, 'click', 'density=8 progress=page menu=3/4')
  const newCount = Number(densityMessage.match(/page=\d+\/(\d+)/)?.[1])
  if (!oldCount || !newCount || oldCount === newCount) {
    throw new Error(`Density did not change repaginated page count: ${pageStyleMessage} -> ${densityMessage}`)
  }
  const densityEightMenu = await screenshotUntilStable('07-menu-density-8.png')
  const densityBodyDiff = pixelDifferenceRegion(
    densitySixMenu, densityEightMenu, BODY_START_Y, DEFAULT_BODY_END_Y,
  )
  const densityFooterDiff = pixelDifferenceRegion(
    densitySixMenu, densityEightMenu, COMPACT_FOOTER_START_Y, FOOTER_END_Y,
  )
  if (densityBodyDiff === 0) throw new Error('Density activation did not change the body region')
  if (densityFooterDiff === 0) throw new Error('Density activation did not change the footer region')

  await moveMenuCursor(simulator, 3, 1)
  await performAction(simulator, 'click', `screen=reader selection=2/2 book=${seedId}`)
  const compactPage1 = await screenshotUntilStable('08-reader-page-1-compact.png')
  if (pixelDifferenceRegion(densityEightMenu, compactPage1, BODY_START_Y, DEFAULT_BODY_END_Y) === 0) {
    throw new Error('Continue did not restore the reader body from the menu')
  }

  // Reader page turns are down/up; click is reserved for the menu.
  await performAction(simulator, 'down', `screen=reader selection=2/2 book=${seedId} page=2/`)
  const page2 = await screenshotUntilStable('09-reader-page-2.png')
  const nextBodyDiff = pixelDifferenceRegion(compactPage1, page2, BODY_START_Y, DEFAULT_BODY_END_Y)
  const nextFooterDiff = pixelDifferenceRegion(compactPage1, page2, COMPACT_FOOTER_START_Y, FOOTER_END_Y)
  if (nextBodyDiff === 0) throw new Error('Scroll-down from page 1 to 2 did not change the body region')
  if (nextFooterDiff === 0) throw new Error('Scroll-down from page 1 to 2 did not change the footer region')

  await performAction(simulator, 'up', `screen=reader selection=2/2 book=${seedId} page=1/`)
  const returnedPage1 = await screenshotUntilStable('10-reader-page-1-after-up.png')
  if (pixelDifferenceRegion(compactPage1, returnedPage1, BODY_START_Y, DEFAULT_BODY_END_Y) !== 0) {
    throw new Error('Scroll-up did not restore page 1 body pixels')
  }
  if (pixelDifferenceRegion(compactPage1, returnedPage1, COMPACT_FOOTER_START_Y, FOOTER_END_Y) !== 0) {
    throw new Error('Scroll-up did not restore page 1 footer pixels')
  }

  // Move to a non-default page before relaunch so persistence cannot pass by
  // merely falling back to page 1.
  await performAction(simulator, 'down', `book=${seedId} page=2/`)

  await stop(simulator)
  simulator = undefined
  // Durability proof: the second process must load the seeded book and page
  // from IndexedDB. Omitting the seed query prevents DEV startup from
  // evicting/reimporting the fixture and masking broken durable writes.
  const relaunch = await launchSimulator(false)
  simulator = relaunch.child
  if (relaunch.screen !== 'reader' || relaunch.bookId !== seedId || relaunch.page !== 2) {
    throw new Error(`Relaunch did not resume directly into the saved book/page: ${relaunch.message}`)
  }
  const restoredPage2 = await screenshotUntilStable('11-resumed-reader-page-2.png')
  if (pixelDifferenceRegion(page2, restoredPage2, BODY_START_Y, DEFAULT_BODY_END_Y) !== 0) {
    throw new Error('Relaunch did not restore page 2 body pixels')
  }
  if (pixelDifferenceRegion(page2, restoredPage2, COMPACT_FOOTER_START_Y, FOOTER_END_Y) !== 0) {
    throw new Error('Relaunch did not restore page 2 footer pixels')
  }

  console.log(
    `SIM_PROOF_OK page_body_changed=${nextBodyDiff} page_footer_changed=${nextFooterDiff} ` +
    `footer_percent_page=${percentToPageFooterDiff} footer_page_hidden=${pageToHiddenFooterDiff} ` +
    `density_body_changed=${densityBodyDiff} density_footer_changed=${densityFooterDiff} seeded_book=${seedId}`,
  )
} finally {
  await cleanupAll()
}
