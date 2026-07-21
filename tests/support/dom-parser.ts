interface MiniAttributeMap {
  [name: string]: string
}

class MiniNode {
  parentNode: MiniNode | null = null
  childNodes: MiniNode[] = []

  constructor(readonly nodeType: number) {}

  get firstChild(): MiniNode | null {
    return this.childNodes[0] ?? null
  }

  get nextSibling(): MiniNode | null {
    if (!this.parentNode) return null
    const index = this.parentNode.childNodes.indexOf(this)
    return this.parentNode.childNodes[index + 1] ?? null
  }

  get textContent(): string {
    return this.childNodes.map(child => child.textContent).join('')
  }

  append(child: MiniNode): void {
    child.parentNode = this
    this.childNodes.push(child)
  }

  remove(): void {
    if (!this.parentNode) return
    this.parentNode.childNodes = this.parentNode.childNodes.filter(child => child !== this)
    this.parentNode = null
  }
}

class MiniText extends MiniNode {
  constructor(private readonly value: string) {
    super(3)
  }

  override get textContent(): string {
    return this.value
  }
}

class MiniElement extends MiniNode {
  readonly tagName: string
  readonly localName: string

  constructor(name: string, private readonly attributes: MiniAttributeMap = {}) {
    super(1)
    this.tagName = name
    this.localName = name.split(':').pop()?.toLowerCase() ?? name.toLowerCase()
  }

  get parentElement(): MiniElement | null {
    return this.parentNode instanceof MiniElement ? this.parentNode : null
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null
  }

  getElementsByTagName(name: string): MiniElement[] {
    const expected = name.toLowerCase()
    return descendants(this).filter(element => (
      name === '*' || element.tagName.toLowerCase() === expected || element.localName === expected
    ))
  }
}

class MiniDocument extends MiniNode {
  constructor() {
    super(9)
  }

  get documentElement(): MiniElement | null {
    return this.childNodes.find(child => child instanceof MiniElement) as MiniElement | undefined ?? null
  }

  get body(): MiniElement | null {
    return this.getElementsByTagName('body')[0] ?? null
  }

  getElementsByTagName(name: string): MiniElement[] {
    const root = this.documentElement
    if (!root) return []
    const expected = name.toLowerCase()
    return [root, ...descendants(root)].filter(element => (
      name === '*' || element.tagName.toLowerCase() === expected || element.localName === expected
    ))
  }
}

function descendants(node: MiniNode): MiniElement[] {
  return node.childNodes.flatMap(child => (
    child instanceof MiniElement ? [child, ...descendants(child)] : descendants(child)
  ))
}

function decodeEntities(value: string): string {
  // Test support intentionally recognizes only these hardcoded entities and
  // does not implement DOCTYPE declarations. Production rejects internal DTDs
  // before DOMParser; parser conformance remains a real-WebView/device check.
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (match, decimal, hexadecimal, named) => {
    if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10))
    if (hexadecimal) return String.fromCodePoint(Number.parseInt(hexadecimal, 16))
    const replacements: Record<string, string> = {
      amp: '&', apos: "'", gt: '>', lt: '<', quot: '"', nbsp: '\u00a0',
    }
    return replacements[String(named).toLowerCase()] ?? match
  })
}

function parserError(message: string): MiniDocument {
  const document = new MiniDocument()
  const element = new MiniElement('parsererror')
  element.append(new MiniText(message))
  document.append(element)
  return document
}

export class TestDomParser {
  parseFromString(source: string): Document {
    const document = new MiniDocument()
    const stack: Array<MiniDocument | MiniElement> = [document]
    const tokens = source.match(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<[^>]+>|[^<]+/gi) ?? []

    for (const token of tokens) {
      if (token.startsWith('<!--') || token.startsWith('<?') || /^<!DOCTYPE/i.test(token)) continue
      if (token.startsWith('<![CDATA[')) {
        stack.at(-1)?.append(new MiniText(token.slice(9, -3)))
        continue
      }
      if (token.startsWith('</')) {
        const closingName = token.slice(2, -1).trim().toLowerCase()
        const current = stack.at(-1)
        if (!(current instanceof MiniElement) || current.tagName.toLowerCase() !== closingName) {
          return parserError(`Mismatched closing tag ${closingName}`) as unknown as Document
        }
        stack.pop()
        continue
      }
      if (token.startsWith('<')) {
        const selfClosing = /\/\s*>$/.test(token)
        const content = token.slice(1, selfClosing ? token.lastIndexOf('/') : -1).trim()
        const nameMatch = content.match(/^([^\s/>]+)/)
        if (!nameMatch) return parserError('Invalid opening tag') as unknown as Document
        const attributes: MiniAttributeMap = {}
        const attributeSource = content.slice(nameMatch[0].length)
        const attributePattern = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
        for (const match of attributeSource.matchAll(attributePattern)) {
          attributes[match[1]] = decodeEntities(match[2] ?? match[3] ?? '')
        }
        const element = new MiniElement(nameMatch[0], attributes)
        stack.at(-1)?.append(element)
        if (!selfClosing) stack.push(element)
        continue
      }
      stack.at(-1)?.append(new MiniText(decodeEntities(token)))
    }

    return (stack.length === 1 && document.documentElement
      ? document
      : parserError('Unclosed or missing root element')) as unknown as Document
  }
}
