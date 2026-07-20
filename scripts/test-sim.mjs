import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'

if (Number(process.versions.node.split('.')[0]) < 20) {
  throw new Error('test:sim requires Node.js 20 or newer')
}

const appUrl = 'http://127.0.0.1:4173/'
const automationUrl = 'http://127.0.0.1:9898'
const evidenceDir = new URL('../evidence/', import.meta.url)
const children = new Set()

function launch(command, args, label) {
  const child = spawn(command, args, {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.add(child)
  child.stdout.on('data', chunk => process.stdout.write(`[${label}] ${chunk}`))
  child.stderr.on('data', chunk => process.stderr.write(`[${label}] ${chunk}`))
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

async function get(path) {
  const response = await fetch(`${automationUrl}${path}`, { signal: AbortSignal.timeout(2_000) })
  if (!response.ok) throw new Error(`${path} returned ${response.status}`)
  return response
}

async function waitForConsole(text) {
  return waitFor(async () => {
    const body = await (await get('/api/console')).json()
    const entry = body.entries?.find(entry => String(entry.message).includes(text))
    return entry ? String(entry.message) : false
  }, `console entry containing ${JSON.stringify(text)}`)
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

async function screenshot(name) {
  const bytes = Buffer.from(await (await get('/api/screenshot/glasses')).arrayBuffer())
  await writeFile(new URL(name, evidenceDir), bytes)
  return bytes
}

async function screenshotUntilStable(name, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  let previous
  while (Date.now() < deadline) {
    const current = Buffer.from(await (await get('/api/screenshot/glasses')).arrayBuffer())
    if (previous?.equals(current)) {
      await writeFile(new URL(name, evidenceDir), current)
      return current
    }
    previous = current
    await delay(200)
  }
  throw new Error(`Timed out waiting for stable screenshot ${JSON.stringify(name)}`)
}

function rgbaPixels(png) {
  const signature = '89504e470d0a1a0a'
  if (png.subarray(0, 8).toString('hex') !== signature) throw new Error('Screenshot is not a PNG')
  let offset = 8
  let width = 0
  let height = 0
  const idat = []
  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.subarray(offset + 4, offset + 8).toString('ascii')
    const data = png.subarray(offset + 8, offset + 8 + length)
    offset += length + 12
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) {
        throw new Error('Expected a non-interlaced 8-bit RGBA simulator screenshot')
      }
    }
    if (type === 'IDAT') idat.push(data)
    if (type === 'IEND') break
  }

  const packed = inflateSync(Buffer.concat(idat))
  const stride = width * 4
  const pixels = Buffer.alloc(stride * height)
  let source = 0
  for (let y = 0; y < height; y++) {
    const filter = packed[source++]
    const row = pixels.subarray(y * stride, (y + 1) * stride)
    const previous = y ? pixels.subarray((y - 1) * stride, y * stride) : undefined
    for (let x = 0; x < stride; x++) {
      const raw = packed[source++]
      const left = x >= 4 ? row[x - 4] : 0
      const up = previous?.[x] ?? 0
      const upperLeft = previous && x >= 4 ? previous[x - 4] : 0
      if (filter === 0) row[x] = raw
      else if (filter === 1) row[x] = raw + left
      else if (filter === 2) row[x] = raw + up
      else if (filter === 3) row[x] = raw + Math.floor((left + up) / 2)
      else if (filter === 4) {
        const estimate = left + up - upperLeft
        const pa = Math.abs(estimate - left)
        const pb = Math.abs(estimate - up)
        const pc = Math.abs(estimate - upperLeft)
        row[x] = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft)
      } else throw new Error(`Unsupported PNG filter ${filter}`)
    }
  }
  return { width, height, pixels }
}

function pixelDifference(leftPng, rightPng) {
  const left = rgbaPixels(leftPng)
  const right = rgbaPixels(rightPng)
  if (left.width !== right.width || left.height !== right.height) {
    throw new Error('Screenshot dimensions changed unexpectedly')
  }
  let changed = 0
  for (let index = 0; index < left.pixels.length; index += 4) {
    if (!left.pixels.subarray(index, index + 4).equals(right.pixels.subarray(index, index + 4))) changed++
  }
  return changed
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

async function assertNoStaleSimulator() {
  try {
    const response = await fetch(`${automationUrl}/api/ping`, {
      signal: AbortSignal.timeout(1_000),
    })
    throw new Error(
      `Refusing to start: a simulator automation API is already answering at ${automationUrl}/api/ping ` +
        `(status ${response.status}). Stop the stale simulator and retry.`,
    )
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Refusing to start:')) throw error
  }
}

async function launchSimulator() {
  const simulator = launch(
    'node_modules/.bin/evenhub-simulator',
    [appUrl, '--automation-port', '9898'],
    'simulator',
  )
  await waitFor(async () => (await (await get('/api/ping')).text()) === 'pong', 'simulator API')
  const readyMessage = await waitForConsole('G2_READER_READY screen=library page=')
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
  await assertNoStaleSimulator()
  await mkdir(evidenceDir, { recursive: true })
  preview = launch(
    'node_modules/.bin/vite',
    ['preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'],
    'preview',
  )
  await waitFor(async () => (await fetch(appUrl, { signal: AbortSignal.timeout(2_000) })).ok, 'Vite preview')

  const initialLaunch = await launchSimulator()
  simulator = initialLaunch.child
  await screenshot('01-library.png')
  await clearConsole()

  await inject('click')
  await waitForConsole(`G2_READER_STATE screen=reader page=${initialLaunch.page}/`)
  for (let page = initialLaunch.page; page > 1; page--) {
    await clearConsole()
    await inject('up')
    await waitForConsole(`G2_READER_STATE screen=reader page=${page - 1}/`)
  }
  const page1 = await screenshotUntilStable('02-reader-page-1.png')
  await clearConsole()

  await inject('click')
  await waitForConsole('G2_READER_STATE screen=reader page=2/')
  const page2 = await screenshotUntilStable('03-reader-page-2.png')
  const nextDiff = pixelDifference(page1, page2)
  if (nextDiff === 0) throw new Error('Click did not change any rendered pixels between pages 1 and 2')
  await clearConsole()

  await inject('up')
  await waitForConsole('G2_READER_STATE screen=reader page=1/')
  const returnedPage1 = await screenshotUntilStable('04-reader-page-1-after-up.png')
  if (pixelDifference(page1, returnedPage1) !== 0) throw new Error('Scroll-up did not restore page 1 pixels')

  // Move to a non-default page before relaunch so persistence cannot pass by
  // merely falling back to page 1.
  await clearConsole()
  await inject('click')
  await waitForConsole('G2_READER_STATE screen=reader page=2/')

  await stop(simulator)
  const relaunch = await launchSimulator()
  simulator = relaunch.child
  if (relaunch.page !== 2) {
    throw new Error(`Relaunch restored page ${relaunch.page}, expected persisted non-default page 2`)
  }
  await clearConsole()
  await inject('click')
  await waitForConsole('G2_READER_STATE screen=reader page=2/')
  const restoredPage2 = await screenshotUntilStable('05-restored-page-2.png')
  if (pixelDifference(page2, restoredPage2) !== 0) throw new Error('Relaunch did not restore page 2 pixels')

  console.log(`SIM_PROOF_OK changed_pixels=${nextDiff}`)
} finally {
  await stop(simulator)
  await stop(preview)
  for (const child of children) await stop(child)
}
