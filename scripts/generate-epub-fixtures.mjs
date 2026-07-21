import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const FIXED_DATE = new Date('2000-01-01T00:00:00.000Z')
const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const DEFAULT_OUTPUT_DIRECTORY = resolve(SCRIPT_DIRECTORY, '../tests/fixtures')

const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

const xhtml = body => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Fixture</title></head><body>${body}</body></html>`

const validChapters = [
  {
    id: 'chapter-1',
    href: 'text/chapter-1.xhtml',
    body: '<nav>Hidden navigation</nav><h1>Chapter One</h1><p>First paragraph with <em>inline emphasis</em>.</p><style>.hidden{}</style><p>Second paragraph.<img alt="Ignored image words" src="cover.png"/></p>',
  },
  {
    id: 'chapter-2',
    href: 'text/chapter-2.xhtml',
    body: '<script>Hidden script words</script><h2>Chapter Two</h2><p>Another readable paragraph.</p>',
  },
]

const obfuscation = (uri, extraEncryptedData = '') => `<?xml version="1.0" encoding="UTF-8"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><enc:CipherData><enc:CipherReference URI="${uri}"/></enc:CipherData></enc:EncryptedData>
  ${extraEncryptedData}
</encryption>`

const encryptedChapter = '<enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes256-cbc"/><enc:CipherData><enc:CipherReference URI="OEBPS/text/chapter-1.xhtml"/></enc:CipherData></enc:EncryptedData>'

const fixtureDefinitions = {
  'valid-two-chapters.epub': {
    title: 'Small Fixture Book', author: 'Ada Reader', chapters: validChapters,
  },
  'drm-encrypted.epub': {
    title: 'Locked Fixture',
    chapters: [{ id: 'locked', href: 'text/locked.xhtml', body: '<p>Text that must not be imported.</p>' }],
    extraFiles: {
      'META-INF/encryption.xml': `<?xml version="1.0" encoding="UTF-8"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  ${encryptedChapter}
</encryption>`,
    },
  },
  'fixed-layout.epub': {
    title: 'Fixed Fixture', layout: 'pre-paginated',
    chapters: [{ id: 'page', href: 'text/page.xhtml', body: '<p>Positioned fixed-layout words.</p>' }],
  },
  'empty-content.epub': {
    title: 'Empty Fixture',
    chapters: [{ id: 'empty', href: 'text/empty.xhtml', body: '<nav>Navigation only</nav><script>Script only</script><style>body{}</style><img alt="Alt text only" src="image.png"/>' }],
  },
  'many-entries.epub': {
    title: 'Many Entries', chapters: [validChapters[0]],
    extraFiles: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`OEBPS/extras/${index}.txt`, ''])),
  },
  'forged-size.epub': {
    title: 'Forged Size',
    chapters: [{ id: 'large', href: 'text/large.xhtml', body: `<p>${'expansion '.repeat(900)}</p>` }],
    forgeDeclaredSize: { path: 'OEBPS/text/large.xhtml', size: 1 },
  },
  'entity-declaration.epub': {
    title: 'Entity Declaration',
    chapters: [{
      id: 'entity', href: 'text/entity.xhtml', raw: `<?xml version="1.0"?>
<!DOCTYPE html [<!ENTITY repeated "expanded text">]>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>&repeated;</p></body></html>`,
    }],
  },
  'repeated-spine.epub': {
    title: 'Repeated Spine', chapters: [validChapters[0]], spineIds: ['chapter-1', 'chapter-1'],
  },
  'duplicate-manifest-id.epub': {
    title: 'Duplicate Manifest ID',
    chapters: [validChapters[0]],
    extraManifestItems: [{ id: 'chapter-1', href: 'text/other.xhtml', mediaType: 'application/xhtml+xml' }],
    extraFiles: { 'OEBPS/text/other.xhtml': xhtml('<p>Other content.</p>') },
  },
  'missing-spine-entry.epub': {
    title: 'Missing Spine Entry',
    chapters: [{ id: 'missing', href: 'text/missing.xhtml', body: '<p>Missing.</p>', omitFile: true }],
  },
  'obfuscated-extensionless-font.epub': {
    title: 'Extensionless Font', chapters: [validChapters[0]],
    extraManifestItems: [{ id: 'font', href: 'fonts/BodyFont', mediaType: 'font/otf' }],
    extraFiles: {
      'OEBPS/fonts/BodyFont': 'obfuscated font bytes',
      'META-INF/encryption.xml': obfuscation('OEBPS/fonts/BodyFont'),
    },
  },
  'obfuscated-percent-encoded-font.epub': {
    title: 'Encoded Font', chapters: [validChapters[0]],
    extraManifestItems: [{ id: 'font', href: 'fonts/Body Font', mediaType: 'font/woff2' }],
    extraFiles: {
      'OEBPS/fonts/Body Font': 'obfuscated font bytes',
      'META-INF/encryption.xml': obfuscation('OEBPS/fonts/Body%20Font'),
    },
  },
  'mixed-encryption.epub': {
    title: 'Mixed Encryption', chapters: validChapters,
    extraManifestItems: [{ id: 'font', href: 'fonts/BodyFont', mediaType: 'application/vnd.ms-opentype' }],
    extraFiles: {
      'OEBPS/fonts/BodyFont': 'obfuscated font bytes',
      'META-INF/encryption.xml': obfuscation('OEBPS/fonts/BodyFont', encryptedChapter),
    },
  },
  'wrong-mimetype.epub': {
    title: 'Wrong Mimetype', chapters: [validChapters[0]], mimetype: 'application/zip',
  },
  'missing-mimetype.epub': {
    title: 'Missing Mimetype', chapters: [validChapters[0]], omitMimetype: true,
  },
  'unsafe-path.epub': {
    title: 'Unsafe Path', chapters: [validChapters[0]], containerPath: '../META-INF/container.xml',
  },
}

function packageDocument(definition) {
  const manifestItems = [
    ...definition.chapters.map(chapter => ({
      id: chapter.id, href: chapter.href, mediaType: chapter.mediaType ?? 'application/xhtml+xml',
    })),
    ...(definition.extraManifestItems ?? []),
  ]
  const manifest = manifestItems.map(item => (
    `<item id="${item.id}" href="${item.href}" media-type="${item.mediaType}"/>`
  )).join('\n    ')
  const spine = (definition.spineIds ?? definition.chapters.map(chapter => chapter.id))
    .map(id => `<itemref idref="${id}"/>`).join('\n    ')
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0">
  <metadata>
    ${definition.title ? `<dc:title>${definition.title}</dc:title>` : ''}
    ${definition.author ? `<dc:creator>${definition.author}</dc:creator>` : ''}
    ${definition.layout ? `<meta property="rendition:layout">${definition.layout}</meta>` : ''}
  </metadata>
  <manifest>
    ${manifest}
  </manifest>
  <spine>
    ${spine}
  </spine>
</package>`
}

function addFile(zip, path, contents, compression = 'DEFLATE') {
  zip.file(path, contents, {
    date: FIXED_DATE,
    createFolders: false,
    compression,
    compressionOptions: compression === 'DEFLATE' ? { level: 9 } : undefined,
  })
}

function forgeCentralDirectorySize(bytes, targetPath, declaredSize) {
  const output = Buffer.from(bytes)
  const signature = 0x02014b50
  for (let offset = 0; offset <= output.length - 46; offset += 1) {
    if (output.readUInt32LE(offset) !== signature) continue
    const filenameLength = output.readUInt16LE(offset + 28)
    const extraLength = output.readUInt16LE(offset + 30)
    const commentLength = output.readUInt16LE(offset + 32)
    const name = output.subarray(offset + 46, offset + 46 + filenameLength).toString('utf8')
    if (name === targetPath) {
      output.writeUInt32LE(declaredSize, offset + 24)
      return output
    }
    offset += 45 + filenameLength + extraLength + commentLength
  }
  throw new Error(`Unable to forge central-directory entry: ${targetPath}`)
}

async function generateEpub(definition) {
  const zip = new JSZip()
  if (!definition.omitMimetype) addFile(zip, 'mimetype', definition.mimetype ?? 'application/epub+zip', 'STORE')
  addFile(zip, definition.containerPath ?? 'META-INF/container.xml', containerXml)
  addFile(zip, 'OEBPS/content.opf', packageDocument(definition))
  for (const chapter of definition.chapters) {
    if (!chapter.omitFile) addFile(zip, `OEBPS/${chapter.href}`, chapter.raw ?? xhtml(chapter.body))
  }
  for (const [path, contents] of Object.entries(definition.extraFiles ?? {})) addFile(zip, path, contents)
  const bytes = await zip.generateAsync({
    type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'DOS',
  })
  return definition.forgeDeclaredSize
    ? forgeCentralDirectorySize(bytes, definition.forgeDeclaredSize.path, definition.forgeDeclaredSize.size)
    : bytes
}

function parseArguments(arguments_) {
  let outputDirectory = DEFAULT_OUTPUT_DIRECTORY
  const selected = []
  for (let index = 0; index < arguments_.length; index += 1) {
    if (arguments_[index] === '--output-dir') {
      const value = arguments_[index + 1]
      if (!value) throw new Error('--output-dir requires a path')
      outputDirectory = resolve(value)
      index += 1
    } else {
      selected.push(arguments_[index])
    }
  }
  return { outputDirectory, selected }
}

const { outputDirectory, selected } = parseArguments(process.argv.slice(2))
const knownFixtures = [...Object.keys(fixtureDefinitions), 'malformed-zip.epub']
const requestedFixtures = selected.length ? selected : knownFixtures
for (const name of requestedFixtures) {
  if (!knownFixtures.includes(name)) throw new Error(`Unknown EPUB fixture: ${name}`)
}

mkdirSync(outputDirectory, { recursive: true })
for (const name of requestedFixtures) {
  const bytes = name === 'malformed-zip.epub'
    ? Buffer.from('This is deliberately not a ZIP archive.\n', 'utf8')
    : await generateEpub(fixtureDefinitions[name])
  writeFileSync(join(outputDirectory, name), bytes)
  console.log(`Wrote ${join(outputDirectory, name)}`)
}
