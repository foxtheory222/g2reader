import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TestDomParser } from '../tests/support/dom-parser'
import { MAX_EPUB_CHARACTERS, extractEpubText } from './epub-extract'

const originalDomParser = globalThis.DOMParser

beforeAll(() => {
  globalThis.DOMParser = TestDomParser as unknown as typeof DOMParser
})

afterAll(() => {
  globalThis.DOMParser = originalDomParser
})

async function fixture(name: string): Promise<ArrayBuffer> {
  const bytes = await readFile(new URL(`../tests/fixtures/${name}`, import.meta.url))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

describe('EPUB text extraction', () => {
  it('pins the EPUB extracted-character limit', () => {
    expect(MAX_EPUB_CHARACTERS).toBe(4_000_000)
  })

  it('reads metadata and spine chapters in order with paragraph and chapter offsets', async () => {
    const result = await extractEpubText(await fixture('valid-two-chapters.epub'), 'download.epub')

    expect(result).toEqual({
      status: 'ready',
      text: [
        'Chapter One\n\nFirst paragraph with inline emphasis.\n\nSecond paragraph.',
        'Chapter Two\n\nAnother readable paragraph.',
      ].join('\n\n'),
      meta: {
        title: 'Small Fixture Book',
        author: 'Ada Reader',
        chapterCount: 2,
        charCount: 111,
        chapterOffsets: [0, 71],
      },
    })
    expect(result.status === 'ready' ? result.text : '').not.toMatch(/Hidden|Ignored image words/)
  })

  it.each([
    ['drm-encrypted.epub', 'DRM-protected'],
    ['malformed-zip.epub', 'not a valid EPUB'],
    ['fixed-layout.epub', 'fixed-layout'],
    ['empty-content.epub', 'does not contain readable text'],
  ])('honestly refuses %s', async (name, reasonFragment) => {
    const result = await extractEpubText(await fixture(name), name)

    expect(result.status).toBe('unsupported')
    expect(result.status === 'unsupported' ? result.reason : '').toContain(reasonFragment)
    expect(result.meta).toMatchObject({
      chapterCount: expect.any(Number),
      charCount: expect.any(Number),
      chapterOffsets: expect.any(Array),
    })
  })

  it('classifies missing or malformed container and OPF structures as invalid EPUBs', async () => {
    const cases: Array<(zip: JSZip) => void> = [
      zip => { zip.remove('META-INF/container.xml') },
      zip => { zip.file('META-INF/container.xml', '<container><rootfiles>') },
      zip => { zip.file('OEBPS/content.opf', '<package><metadata></package>') },
      zip => {
        const entry = zip.file('OEBPS/content.opf')
        if (!entry) throw new Error('fixture OPF missing')
        zip.file('OEBPS/content.opf', '<package><metadata/><manifest/><spine><itemref idref="missing"/></spine></package>')
      },
    ]

    for (const mutate of cases) {
      const zip = await JSZip.loadAsync(await fixture('valid-two-chapters.epub'))
      mutate(zip)
      const result = await extractEpubText(await zip.generateAsync({ type: 'arraybuffer' }), 'broken.epub')
      expect(result.status).toBe('unsupported')
      expect(result.status === 'unsupported' ? result.reason : '').toContain('not a valid EPUB')
    }
  })

  it('allows standard font obfuscation but refuses rights.xml', async () => {
    const fontZip = await JSZip.loadAsync(await fixture('valid-two-chapters.epub'))
    fontZip.file('OEBPS/fonts/body.otf', 'obfuscated font bytes')
    const opf = await fontZip.file('OEBPS/content.opf')!.async('string')
    fontZip.file('OEBPS/content.opf', opf.replace(
      '</manifest>',
      '<item id="body-font" href="fonts/body.otf" media-type="font/otf"/></manifest>',
    ))
    fontZip.file('META-INF/encryption.xml', `
      <encryption xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
        <enc:EncryptedData>
          <enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/>
          <enc:CipherData><enc:CipherReference URI="OEBPS/fonts/body.otf"/></enc:CipherData>
        </enc:EncryptedData>
      </encryption>
    `)
    const fontResult = await extractEpubText(await fontZip.generateAsync({ type: 'arraybuffer' }), 'font.epub')
    expect(fontResult.status).toBe('ready')

    fontZip.file('META-INF/rights.xml', '<rights/>')
    const rightsResult = await extractEpubText(await fontZip.generateAsync({ type: 'arraybuffer' }), 'rights.epub')
    expect(rightsResult.status).toBe('unsupported')
    expect(rightsResult.status === 'unsupported' ? rightsResult.reason : '').toContain('DRM-protected')
  })

  it.each([
    'obfuscated-extensionless-font.epub',
    'obfuscated-percent-encoded-font.epub',
  ])('allows recognized obfuscation of a manifest-declared font in %s', async name => {
    const result = await extractEpubText(await fixture(name), name)

    expect(result.status).toBe('ready')
  })

  it('refuses mixed font obfuscation and encrypted chapter content', async () => {
    const result = await extractEpubText(await fixture('mixed-encryption.epub'), 'mixed-encryption.epub')

    expect(result.status).toBe('unsupported')
    expect(result.status === 'unsupported' ? result.reason : '').toContain('DRM-protected')
  })

  it('enforces declared and emitted decompression budgets with injected small limits', async () => {
    const tooMany = await extractEpubText(await fixture('many-entries.epub'), 'many-entries.epub', {
      maxEntryCount: 8,
    })
    expect(tooMany.status === 'unsupported' ? tooMany.reason : '').toContain('8-entry archive limit')

    const declaredTotal = await extractEpubText(await fixture('valid-two-chapters.epub'), 'valid.epub', {
      maxTotalUncompressedBytes: 1_000,
    })
    expect(declaredTotal.status === 'unsupported' ? declaredTotal.reason : '').toContain('1,000-byte cumulative decompression limit')

    // The forged fixture declares one byte for a multi-kilobyte chapter in its
    // central directory, so only the streaming emitted-byte ceiling catches it.
    const forged = await extractEpubText(await fixture('forged-size.epub'), 'forged-size.epub', {
      maxEntryUncompressedBytes: 1_024,
    })
    expect(forged.status === 'unsupported' ? forged.reason : '').toContain('1,024-byte per-entry decompression limit')
  })

  it('bounds spine itemrefs before chapter inflation', async () => {
    const result = await extractEpubText(await fixture('repeated-spine.epub'), 'repeated-spine.epub', {
      maxSpineItems: 1,
    })

    expect(result.status).toBe('unsupported')
    expect(result.status === 'unsupported' ? result.reason : '').toContain('1-item spine limit')
  })

  it('refuses internal DTD and entity declarations before DOM parsing', async () => {
    const result = await extractEpubText(await fixture('entity-declaration.epub'), 'entity-declaration.epub')

    expect(result.status).toBe('unsupported')
    expect(result.status === 'unsupported' ? result.reason : '').toContain('DTD or entity declarations')
  })

  it.each(['wrong-mimetype.epub', 'missing-mimetype.epub', 'unsafe-path.epub'])(
    'rejects invalid OCF identity or unsafe archive paths in %s',
    async name => {
      const result = await extractEpubText(await fixture(name), name)

      expect(result.status).toBe('unsupported')
      expect(result.status === 'unsupported' ? result.reason : '').toContain('not a valid EPUB')
    },
  )

  it('rejects case-colliding OCF entry names', async () => {
    const zip = await JSZip.loadAsync(await fixture('valid-two-chapters.epub'))
    zip.file('meta-inf/container.xml', '<container/>')

    const result = await extractEpubText(await zip.generateAsync({ type: 'arraybuffer' }), 'collision.epub')

    expect(result.status).toBe('unsupported')
    expect(result.status === 'unsupported' ? result.reason : '').toContain('not a valid EPUB')
  })

  it.each(['duplicate-manifest-id.epub', 'repeated-spine.epub', 'missing-spine-entry.epub'])(
    'rejects ambiguous or missing spine resolution in %s',
    async name => {
      const result = await extractEpubText(await fixture(name), name)

      expect(result.status).toBe('unsupported')
      expect(result.status === 'unsupported' ? result.reason : '').toContain('not a valid EPUB')
    },
  )

  it('uses the existing filename title fallback when package metadata omits a title', async () => {
    const zip = await JSZip.loadAsync(await fixture('valid-two-chapters.epub'))
    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    zip.file('OEBPS/content.opf', opf.replace('<dc:title>Small Fixture Book</dc:title>', ''))
    const data = await zip.generateAsync({ type: 'arraybuffer' })

    const result = await extractEpubText(data, '/imports/fallback_name.epub')

    expect(result.meta.title).toBe('fallback_name')
  })

  it('accepts exactly 4,000,000 extracted EPUB characters', async () => {
    const zip = await JSZip.loadAsync(await fixture('valid-two-chapters.epub'))
    const prefix = 'Numbered sentence 1 carries readable classic prose. '
      .repeat(Math.ceil(MAX_EPUB_CHARACTERS / 51))
      .slice(0, MAX_EPUB_CHARACTERS - 1)
    const prose = `${prefix}Z`
    zip.file('OEBPS/text/chapter-1.xhtml', `<html><body><p>${prose}</p></body></html>`)
    zip.remove('OEBPS/text/chapter-2.xhtml')
    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    zip.file('OEBPS/content.opf', opf.replace('<itemref idref="chapter-2"/>', ''))
    const data = await zip.generateAsync({ type: 'arraybuffer' })

    const result = await extractEpubText(data, 'classic.epub')

    expect(prose).toHaveLength(MAX_EPUB_CHARACTERS)
    expect(result.status).toBe('ready')
    expect(result.status === 'ready' ? result.text.length : 0).toBe(MAX_EPUB_CHARACTERS)
  })

  it('stops cumulative expansion beyond the interim 4,000,000-character ceiling', async () => {
    const zip = await JSZip.loadAsync(await fixture('valid-two-chapters.epub'))
    zip.file('OEBPS/text/chapter-1.xhtml', `<html><body><p>${'a'.repeat(MAX_EPUB_CHARACTERS + 1)}</p></body></html>`)
    const data = await zip.generateAsync({ type: 'arraybuffer' })

    const result = await extractEpubText(data, 'large.epub')

    expect(result.status).toBe('unsupported')
    expect(result.status === 'unsupported' ? result.reason : '').toContain('4,000,000 characters')
  })

  it('reuses the existing corruption philosophy for degenerate extracted text', async () => {
    const zip = await JSZip.loadAsync(await fixture('valid-two-chapters.epub'))
    zip.file('OEBPS/text/chapter-1.xhtml', `<html><body><p>${'a'.repeat(100)}</p></body></html>`)
    zip.file('OEBPS/text/chapter-2.xhtml', '<html><body></body></html>')
    const data = await zip.generateAsync({ type: 'arraybuffer' })

    const result = await extractEpubText(data, 'garbage.epub')

    expect(result.status).toBe('unsupported')
    expect(result.status === 'unsupported' ? result.reason : '').toContain('mostly unreadable')
  })
})
