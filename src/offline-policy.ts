export interface ReviewedUrl {
  literal: string
  comment: string
}

const ABSOLUTE_URL_PATTERN = /\b(?:https?|wss?):\/\/[^\s"'`<>)\\]+/gi
const PROTOCOL_RELATIVE_PATTERN = /["'`(](\/\/[a-z0-9.-]+[^\s"'`<>)\\]*)/gi

export function findNetworkLiterals(contents: string): string[] {
  const absolute = contents.match(ABSOLUTE_URL_PATTERN) ?? []
  const protocolRelative = [...contents.matchAll(PROTOCOL_RELATIVE_PATTERN)].map(match => match[1])
  return [...absolute, ...protocolRelative]
}

function comparableUrl(literal: string) {
  return new URL(literal.startsWith('//') ? `https:${literal}` : literal)
}

export function isReviewedUrl(literal: string, entries: ReviewedUrl[]): boolean {
  let candidate: URL
  try {
    candidate = comparableUrl(literal)
  } catch {
    return false
  }

  return entries.some(entry => {
    let reviewed: URL
    try {
      reviewed = comparableUrl(entry.literal)
    } catch {
      return false
    }
    if (candidate.origin !== reviewed.origin) return false
    const prefix = reviewed.pathname
    return candidate.pathname === prefix || (
      prefix.endsWith('/') ? candidate.pathname.startsWith(prefix) : candidate.pathname.startsWith(`${prefix}/`)
    )
  })
}

export function countNetworkToken(contents: string, token: string): number {
  if (!token) return 0
  let count = 0
  let offset = 0
  while ((offset = contents.indexOf(token, offset)) !== -1) {
    count++
    offset += token.length
  }
  return count
}
