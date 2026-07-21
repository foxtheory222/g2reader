import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { countNetworkToken, findNetworkLiterals, isReviewedUrl, type ReviewedUrl } from './offline-policy'

interface NetworkApiEntry {
  token: string
  count: number
  comment: string
}

interface OfflineAllowlist {
  urlEntries: ReviewedUrl[]
  networkApiTokens: NetworkApiEntry[]
}

const NETWORK_API_TOKENS = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'sendBeacon',
  'importScripts',
] as const
const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.map', '.mjs', '.svg', '.txt'])
const ROOT = new URL('..', import.meta.url).pathname
const DIST = join(ROOT, 'dist')

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesBelow(path) : [path]
  })
}

function findWhitelistKeys(value: unknown, path = 'app.json'): string[] {
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = `${path}.${key}`
    const own = key.toLowerCase().includes('whitelist') ? [childPath] : []
    return own.concat(findWhitelistKeys(child, childPath))
  })
}

function readAllowlist(): OfflineAllowlist {
  return JSON.parse(readFileSync(join(ROOT, 'offline-allowlist.json'), 'utf8')) as OfflineAllowlist
}

describe('offline distribution gate', () => {
  it('censuses bare network API references with identifier boundaries', () => {
    const fixture = 'const request = globalThis.fetch; const prefetch = "not the API"'
    expect(countNetworkToken(fixture, 'fetch')).toBe(1)
  })

  it('keeps app permissions empty and defines no whitelist', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')) as {
      permissions?: unknown
    }

    expect(manifest.permissions, 'app.json permissions must stay []').toEqual([])
    expect(findWhitelistKeys(manifest), 'app.json must not define any whitelist').toEqual([])
  })

  it('contains no unreviewed network literals in a fresh dist build', () => {
    // This gate intentionally fails when dist/ is absent. npm's pretest hook
    // guarantees a fresh build. Binary assets are excluded because they are
    // non-executable and byte-decoding them produces meaningless URL fragments.
    expect(existsSync(DIST), 'dist/ is missing; run a fresh npm run build before the offline gate').toBe(true)
    const allowlist = readAllowlist()
    for (const entry of allowlist.urlEntries) {
      expect(entry.literal.trim(), 'allowlist URL literals must not be empty').not.toBe('')
      expect(entry.comment.trim(), `allowlist entry ${entry.literal} needs a justification`).not.toBe('')
    }

    const violations: string[] = []
    for (const file of filesBelow(DIST)) {
      if (!TEXT_EXTENSIONS.has(extname(file))) continue
      const contents = readFileSync(file, 'utf8')
      for (const literal of findNetworkLiterals(contents)) {
        if (!isReviewedUrl(literal, allowlist.urlEntries)) {
          violations.push(`${file.slice(ROOT.length + 1)}: ${literal}`)
        }
      }
    }

    expect(violations, `unreviewed network literals found:\n${violations.join('\n')}`).toEqual([])
  })

  it('requires exact reviewed counts for every network-capable API token in built JS', () => {
    expect(existsSync(DIST), 'dist/ is missing; run a fresh npm run build before the offline gate').toBe(true)
    const allowlist = readAllowlist()
    const js = filesBelow(DIST)
      .filter(file => extname(file) === '.js' || extname(file) === '.mjs')
      .map(file => readFileSync(file, 'utf8'))
      .join('\n')

    for (const entry of allowlist.networkApiTokens) {
      expect(NETWORK_API_TOKENS, `unknown network API token ${entry.token}`).toContain(entry.token)
      expect(Number.isSafeInteger(entry.count) && entry.count >= 0, `${entry.token} count must be a non-negative safe integer`).toBe(true)
      expect(entry.comment.trim(), `${entry.token} needs a review justification`).not.toBe('')
    }

    const census = NETWORK_API_TOKENS.map(token => ({ token, count: countNetworkToken(js, token) }))
    const drift = census.flatMap(actual => {
      const reviewed = allowlist.networkApiTokens.find(entry => entry.token === actual.token)
      if (actual.count === 0 && !reviewed) return []
      if (!reviewed) return [`${actual.token}: found ${actual.count}, no reviewed allowlist entry`]
      return actual.count === reviewed.count
        ? []
        : [`${actual.token}: found ${actual.count}, reviewed count is ${reviewed.count}`]
    })

    expect(drift, `network API census drifted:\n${drift.join('\n')}`).toEqual([])
  })
})
