import { readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { shouldSeedSimulatorBook } from './sim-seed'

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesBelow(path) : [path]
  })
}

describe('simulator seed gate', () => {
  it('requires both the dev build flag and the explicit URL query', () => {
    expect(shouldSeedSimulatorBook('?simSeedBook=1', true)).toBe(true)
    expect(shouldSeedSimulatorBook('?simSeedBook=1', false)).toBe(false)
    expect(shouldSeedSimulatorBook('', true)).toBe(false)
  })

  it('does not carry the dev-only seed hook in a production build', () => {
    const dist = new URL('../dist/', import.meta.url).pathname
    const builtText = filesBelow(dist)
      .filter(file => ['.js', '.mjs'].includes(extname(file)))
      .map(file => readFileSync(file, 'utf8'))
      .join('\n')
    expect(builtText).not.toContain('simSeedBook')
    expect(builtText).not.toContain('G2 Simulator Seed')
  })
})
