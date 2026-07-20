import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  assertRequiredPortsFree,
  findSeriousConsoleEntries,
  pixelDifferenceRegion,
  screenshotsMatchPixels,
  stopAll,
  waitForChildReadiness,
} from './test-sim-lib.mjs'

if (Number(process.versions.node.split('.')[0]) < 20) {
  throw new Error('test:sim requires Node.js 20 or newer')
}

const appUrl = 'http://127.0.0.1:4173/'
const automationUrl = 'http://127.0.0.1:9898'
const evidenceDir = new URL('../evidence/', import.meta.url)
const BODY_START_Y = 0
const BODY_END_Y = 246
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

async function launchSimulator() {
  await assertPortFree(9898, 'simulator automation')
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
  const readyMessage = await waitForConsole('G2_READER_READY screen=library page=', simulator)
  await assertConsoleHealthy('application readiness')
  const match = readyMessage.match(/page=(\d+)\/(\d+)/)
  if (!match) throw new Error(`Could not parse persisted page from ready log: ${readyMessage}`)
  return {
    child: simulator,
    page: Number(match[1]),
    pageCount: Number(match[2]),
  }
}

let preview
let simulator
try {
  await assertRequiredPortsFree(port => portIsOpen('127.0.0.1', port))
  await mkdir(evidenceDir, { recursive: true })
  preview = launch(
    'node_modules/.bin/vite',
    ['preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'],
    'preview',
  )
  await waitForChild(
    preview,
    async () => (await fetch(appUrl, { signal: AbortSignal.timeout(2_000) })).ok,
    'Vite preview',
  )

  const initialLaunch = await launchSimulator()
  simulator = initialLaunch.child
  const library = await screenshotUntilStable('01-library.png')

  await performAction(simulator, 'click', `G2_READER_STATE screen=reader page=${initialLaunch.page}/`)
  const openedReader = await screenshotUntilStable('01b-opened-reader.png')
  const libraryToReaderBody = pixelDifferenceRegion(library, openedReader, BODY_START_Y, BODY_END_Y)
  if (libraryToReaderBody === 0) throw new Error('Opening the book did not change the reader body region')

  for (let page = initialLaunch.page; page > 1; page--) {
    await performAction(simulator, 'up', `G2_READER_STATE screen=reader page=${page - 1}/`)
  }
  const page1 = await screenshotUntilStable('02-reader-page-1.png')

  await performAction(simulator, 'click', 'G2_READER_STATE screen=reader page=2/')
  const page2 = await screenshotUntilStable('03-reader-page-2.png')
  const nextBodyDiff = pixelDifferenceRegion(page1, page2, BODY_START_Y, BODY_END_Y)
  const nextFooterDiff = pixelDifferenceRegion(page1, page2, BODY_END_Y, FOOTER_END_Y)
  if (nextBodyDiff === 0) throw new Error('Page 1 to 2 did not change the body region')
  if (nextFooterDiff === 0) throw new Error('Page 1 to 2 did not change the footer region')

  await performAction(simulator, 'up', 'G2_READER_STATE screen=reader page=1/')
  const returnedPage1 = await screenshotUntilStable('04-reader-page-1-after-up.png')
  if (pixelDifferenceRegion(page1, returnedPage1, BODY_START_Y, BODY_END_Y) !== 0) {
    throw new Error('Scroll-up did not restore page 1 body pixels')
  }
  if (pixelDifferenceRegion(page1, returnedPage1, BODY_END_Y, FOOTER_END_Y) !== 0) {
    throw new Error('Scroll-up did not restore page 1 footer pixels')
  }

  // Move to a non-default page before relaunch so persistence cannot pass by
  // merely falling back to page 1.
  await performAction(simulator, 'click', 'G2_READER_STATE screen=reader page=2/')

  await stop(simulator)
  simulator = undefined
  const relaunch = await launchSimulator()
  simulator = relaunch.child
  if (relaunch.page !== 2) {
    throw new Error(`Relaunch restored page ${relaunch.page}, expected persisted non-default page 2`)
  }
  await performAction(simulator, 'click', 'G2_READER_STATE screen=reader page=2/')
  const restoredPage2 = await screenshotUntilStable('05-restored-page-2.png')
  if (pixelDifferenceRegion(page2, restoredPage2, BODY_START_Y, BODY_END_Y) !== 0) {
    throw new Error('Relaunch did not restore page 2 body pixels')
  }
  if (pixelDifferenceRegion(page2, restoredPage2, BODY_END_Y, FOOTER_END_Y) !== 0) {
    throw new Error('Relaunch did not restore page 2 footer pixels')
  }

  console.log(
    `SIM_PROOF_OK library_body_changed=${libraryToReaderBody} ` +
    `page_body_changed=${nextBodyDiff} page_footer_changed=${nextFooterDiff}`,
  )
} finally {
  await cleanupAll()
}
