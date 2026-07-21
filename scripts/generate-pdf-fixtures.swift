import CoreGraphics
import CoreText
import Foundation

let workingDirectory = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
let scriptURL = URL(fileURLWithPath: CommandLine.arguments[0], relativeTo: workingDirectory).standardizedFileURL
let repositoryRoot = scriptURL.deletingLastPathComponent().deletingLastPathComponent()
var outputDirectory = repositoryRoot.appendingPathComponent("tests/fixtures", isDirectory: true)
var requestedFixtures = Set<String>()
var argumentIndex = 1
while argumentIndex < CommandLine.arguments.count {
  let argument = CommandLine.arguments[argumentIndex]
  if argument == "--output-dir" {
    guard argumentIndex + 1 < CommandLine.arguments.count else {
      fatalError("--output-dir requires a path")
    }
    outputDirectory = URL(
      fileURLWithPath: CommandLine.arguments[argumentIndex + 1],
      relativeTo: workingDirectory
    ).standardizedFileURL
    argumentIndex += 2
  } else {
    requestedFixtures.insert(argument)
    argumentIndex += 1
  }
}
try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)

let pageRect = CGRect(x: 0, y: 0, width: 612, height: 792)

func drawLine(_ text: String, x: CGFloat, y: CGFloat, size: CGFloat = 12, in context: CGContext) {
  let attributes: [NSAttributedString.Key: Any] = [
    NSAttributedString.Key(kCTFontAttributeName as String): CTFontCreateWithName("Helvetica" as CFString, size, nil),
  ]
  let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attributes))
  context.setFillColor(CGColor(gray: 0, alpha: 1))
  context.textPosition = CGPoint(x: x, y: y)
  CTLineDraw(line, context)
}

func makePdf(named name: String, pages: (_ context: CGContext, _ page: Int) -> Void, count: Int) {
  if !requestedFixtures.isEmpty && !requestedFixtures.contains(name) { return }
  let url = outputDirectory.appendingPathComponent(name)
  let metadata: [CFString: Any] = [
    kCGPDFContextCreator: "G2 Reader fixture generator",
  ]
  guard let context = CGContext(url as CFURL, mediaBox: nil, metadata as CFDictionary) else {
    fatalError("Could not create \(url.path)")
  }
  for page in 0..<count {
    context.beginPDFPage([kCGPDFContextMediaBox as String: pageRect] as CFDictionary)
    context.setFillColor(CGColor(gray: 1, alpha: 1))
    context.fill(pageRect)
    pages(context, page)
    context.endPDFPage()
  }
  context.closePDF()
}

makePdf(named: "simple-prose.pdf", pages: { context, page in
  if page == 0 {
    drawLine("A quiet morning opened over the valley.", x: 72, y: 720, in: context)
    drawLine("Birds crossed the pale sky in patient arcs.", x: 72, y: 702, in: context)
    drawLine("The road below was still empty.", x: 72, y: 666, in: context)
  } else {
    drawLine("By noon, the town had found its ordinary rhythm.", x: 72, y: 720, in: context)
    drawLine("Doors opened and footsteps filled the square.", x: 72, y: 702, in: context)
  }
}, count: 2)

makePdf(named: "hyphenated-lines.pdf", pages: { context, _ in
  drawLine("A conservative choice appears here as corpus evidence.", x: 72, y: 756, in: context)
  drawLine("A conserva-", x: 72, y: 720, in: context)
  drawLine("tive choice keeps this word whole.", x: 72, y: 702, in: context)
  drawLine("A well-", x: 72, y: 666, in: context)
  drawLine("being choice keeps its lexical hyphen without evidence.", x: 72, y: 648, in: context)
}, count: 1)

makePdf(named: "header-footer-furniture.pdf", pages: { context, page in
  let bodyNames = ["Alpha", "Bravo", "Cedar", "Delta", "Ember"]
  drawLine("FIELD REPORT 2026", x: 72, y: 756, size: 10, in: context)
  drawLine("Page \(page + 1)", x: 276, y: 32, size: 10, in: context)
  drawLine("\(bodyNames[page]) body passage belongs here.", x: 72, y: 700, in: context)
  drawLine("This sentence belongs to the page body.", x: 72, y: 682, in: context)
}, count: 5)

makePdf(named: "two-column.pdf", pages: { context, _ in
  for row in 0..<5 {
    let y = CGFloat(720 - row * 24)
    drawLine("Left column line \(row + 1).", x: 48, y: y, in: context)
    drawLine("Right column line \(row + 1).", x: 330, y: y, in: context)
  }
}, count: 1)

makePdf(named: "no-text.pdf", pages: { _, _ in }, count: 2)

makePdf(named: "mostly-image-pages.pdf", pages: { context, page in
  if page == 0 {
    drawLine("Only this cover page has extractable text.", x: 72, y: 720, in: context)
  }
}, count: 4)

makePdf(named: "partial-text-coverage.pdf", pages: { context, page in
  if page < 8 {
    drawLine("Text content for coverage page \(page + 1).", x: 72, y: 500, in: context)
  }
}, count: 10)

makePdf(named: "central-refrain.pdf", pages: { context, page in
  drawLine("KEEP THIS CENTRAL REFRAIN", x: 72, y: 410, in: context)
  drawLine("Rule \(page + 1)", x: 72, y: 380, in: context)
  drawLine("Unique body passage \(page + 1) belongs here.", x: 72, y: 350, in: context)
}, count: 9)

makePdf(named: "repeated-header-cover-only.pdf", pages: { context, page in
  drawLine("SELECTABLE ARCHIVE HEADER", x: 72, y: 756, size: 10, in: context)
  if page == 0 {
    drawLine("Only this cover has meaningful selectable text.", x: 72, y: 500, in: context)
  }
}, count: 10)

print("Generated PDF fixtures in \(outputDirectory.path)")
print("Note: CoreGraphics injects current PDF metadata timestamps; regeneration is not byte-identical.")
