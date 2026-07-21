import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Readpane identity contract', () => {
  it('uses Readpane in companion, HTML, package metadata, and current documentation', () => {
    const main = readFileSync('src/main.ts', 'utf8')
    const html = readFileSync('index.html', 'utf8')
    const readme = readFileSync('README.md', 'utf8')
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { name: string }
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
      name: string
      packages: Record<string, { name?: string }>
    }

    expect(main).toContain('>Readpane</h1>')
    expect(html).toContain('<title>Readpane</title>')
    expect(packageJson.name).toBe('readpane')
    expect(lock.name).toBe('readpane')
    expect(lock.packages['']?.name).toBe('readpane')
    expect(readme).toMatch(/^# Readpane/m)
    expect(readme).toContain('resume')
    expect(readme).toContain('5, 6, and 8')
    expect(readme).toContain('scroll')
    expect(readme).toContain('reader menu')
  })

  it('documents stable harness markers and data-preserving legacy storage names', () => {
    const readme = readFileSync('README.md', 'utf8')

    expect(readme).toContain('G2_READER_*')
    expect(readme).toContain('g2reader:*')
    expect(readme).toContain('IndexedDB')
    expect(readme).toMatch(/user data/i)
  })
})
