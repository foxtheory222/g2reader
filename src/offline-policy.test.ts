import { describe, expect, it } from 'vitest'
import {
  countNetworkToken,
  findNetworkLiterals,
  findProtocolRelativeLiterals,
  isReviewedUrl,
} from './offline-policy'

const reviewed = [{ literal: 'https://api.good.example/v1', comment: 'test fixture' }]

describe('offline URL policy', () => {
  it('matches reviewed URL literals exactly by default', () => {
    expect(isReviewedUrl('https://api.good.example/v1', reviewed)).toBe(true)
    expect(isReviewedUrl('https://api.good.example/v1/books', reviewed)).toBe(false)
    expect(isReviewedUrl('https://api.good.example/v1?book=1', reviewed)).toBe(false)
  })

  it('allows boundary-delimited descendants only for an explicit prefix entry', () => {
    const prefixes = [{ ...reviewed[0], prefix: true }]
    expect(isReviewedUrl('https://api.good.example/v1', prefixes)).toBe(true)
    expect(isReviewedUrl('https://api.good.example/v1/books', prefixes)).toBe(true)
    expect(isReviewedUrl('https://api.good.example/v10', prefixes)).toBe(false)
  })

  it('rejects hostile sibling hosts and path-confusion suffixes', () => {
    expect(isReviewedUrl('https://api.good.example.evil.test/v1', reviewed)).toBe(false)
    expect(isReviewedUrl('https://api.good.example/v10', reviewed)).toBe(false)
    expect(isReviewedUrl('https://api.good.example/v1evil', reviewed)).toBe(false)
  })

  it('requires exact text for reviewed non-concrete URL templates', () => {
    const templates = [{ literal: 'http://${host}', comment: 'test fixture' }]
    expect(isReviewedUrl('http://${host}', templates)).toBe(true)
    expect(isReviewedUrl('http://${other}', templates)).toBe(false)
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

  it('finds unquoted and IPv6 protocol-relative authorities without treating code syntax as URLs', () => {
    const source = [
      '<img src=//evil.example/x>',
      '<a href=//[2001:db8::1]/x>',
      'asset //space-boundary.example/x',
      'const marker = 1; //evil.example/this-is-a-js-comment',
      'const local = "http://localhost"',
      'const divided = a=b//2',
    ].join('\n')

    const literals = findProtocolRelativeLiterals(source)
    expect(literals).toContain('//evil.example/x')
    expect(literals).toContain('//[2001:db8::1]/x')
    expect(literals).toContain('//space-boundary.example/x')
    expect(literals).not.toContain('//evil.example/this-is-a-js-comment')
    expect(findProtocolRelativeLiterals('//evil.example/a comment')).toEqual([])
    expect(findProtocolRelativeLiterals('http://localhost')).toEqual([])
    expect(findProtocolRelativeLiterals('const divided = a=b//2')).toEqual([])
  })

  it('counts every occurrence of a reviewed network API token', () => {
    expect(countNetworkToken('fetch(a);fetch(b); "fetch"; prefetch', 'fetch')).toBe(3)
    expect(countNetworkToken('new WebSocket(a); WebSocket', 'WebSocket')).toBe(2)
  })
})
