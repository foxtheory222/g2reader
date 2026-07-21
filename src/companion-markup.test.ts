import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('companion file picker', () => {
  it('shows all files and relies on honest import routing', () => {
    const source = readFileSync(new URL('./main.ts', import.meta.url), 'utf8')
    const input = source.match(/<input id="bookFile"[^>]*>/)?.[0] ?? ''

    expect(input).not.toContain(' accept=')
    expect(source).toContain('Import a PDF, EPUB, or TXT file')
  })
})
