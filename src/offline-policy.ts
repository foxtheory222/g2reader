export interface ReviewedUrl {
  literal: string
  comment: string
}

const ABSOLUTE_URL_PATTERN = /\b(?:https?|wss?):\/\/[^\s"'`<>)\\]+/gi
const PROTOCOL_RELATIVE_PATTERN = /(^|[="'`(\s])(\/\/(?:(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z0-9-]+)|(?:\[[0-9a-f:.]+\]))(?::\d+)?[^\s"'`<>)\\]*)/gim

function isLikelyCodeComment(contents: string, matchIndex: number, boundary: string) {
  const lineStart = contents.lastIndexOf('\n', matchIndex - 1) + 1
  const linePrefix = contents.slice(lineStart, matchIndex)
  if (linePrefix.includes('//')) return true
  if (!boundary || /^\s+$/.test(boundary)) {
    const context = linePrefix.trim()
    // A protocol-relative literal cannot be bare JavaScript. Treat a leading
    // // or a code-shaped prefix as a line comment, while retaining reviewed
    // plain-text and HTML whitespace-boundary candidates.
    return !context || !/^(?:[a-z][\w:-]*|<[^>]*)$/i.test(context)
  }
  return false
}

export function findProtocolRelativeLiterals(contents: string): string[] {
  return [...contents.matchAll(PROTOCOL_RELATIVE_PATTERN)]
    .filter(match => !isLikelyCodeComment(contents, match.index ?? 0, match[1]))
    .map(match => match[2])
}

export function findNetworkLiterals(contents: string): string[] {
  const absolute = contents.match(ABSOLUTE_URL_PATTERN) ?? []
  return [...absolute, ...findProtocolRelativeLiterals(contents)]
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
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return contents.match(new RegExp(`\\b${escaped}\\b`, 'g'))?.length ?? 0
}
