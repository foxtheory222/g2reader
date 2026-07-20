import { describe, expect, it } from 'vitest'
import { countNetworkToken, findNetworkLiterals, isReviewedUrl } from './offline-policy'

const reviewed = [{ literal: 'https://api.good.example/v1', comment: 'test fixture' }]

describe('offline URL policy', () => {
  it('matches an exact origin and boundary-delimited reviewed path prefix', () => {
    expect(isReviewedUrl('https://api.good.example/v1', reviewed)).toBe(true)
    expect(isReviewedUrl('https://api.good.example/v1/books', reviewed)).toBe(true)
    expect(isReviewedUrl('https://api.good.example/v1?book=1', reviewed)).toBe(true)
  })

  it('rejects hostile sibling hosts and path-confusion suffixes', () => {
    expect(isReviewedUrl('https://api.good.example.evil.test/v1', reviewed)).toBe(false)
    expect(isReviewedUrl('https://api.good.example/v10', reviewed)).toBe(false)
    expect(isReviewedUrl('https://api.good.example/v1evil', reviewed)).toBe(false)
  })

  it('finds HTTP, websocket, and delimiter-led protocol-relative literals', () => {
    const source = [
      'fetch("https://evil.example/a")',
      "new WebSocket('ws://evil.example/socket')",
      '`wss://evil.example/socket`',
      'src="//cdn.evil.example/app.js"',
      '// sourceMappingURL=//not-a-literal.example/file.map',
    ].join('\n')

    expect(findNetworkLiterals(source)).toEqual([
      'https://evil.example/a',
      'ws://evil.example/socket',
      'wss://evil.example/socket',
      '//cdn.evil.example/app.js',
    ])
  })

  it('counts every occurrence of a reviewed network API token', () => {
    expect(countNetworkToken('fetch(a);fetch(b); "fetch("', 'fetch(')).toBe(3)
    expect(countNetworkToken('new WebSocket(a); WebSocket', 'WebSocket')).toBe(2)
  })
})
