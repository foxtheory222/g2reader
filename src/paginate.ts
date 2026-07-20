import { measureTextWrap } from '@evenrealities/pretext'

// Splits long text into page-sized chunks using pretext's pixel-accurate
// glyph measurements — the same ones LVGL uses on the G2 firmware. Pages
// fill the container without clipping or leaving large empty gaps, and
// switching font size or container dimensions just works.
//
// Pass the container's *inner* box (width/height minus padding and border).
// Line height is a fixed 27px in EvenHub's LVGL build.

const LINE_HEIGHT = 27
export const TEXT_UPGRADE_CHARACTER_LIMIT = 2_000

export interface PaginateBox {
  width: number
  height: number
}

export function paginate(source: string, box: PaginateBox): string[] {
  const maxLines = Math.max(1, Math.floor(box.height / LINE_HEIGHT))
  const paragraphs = source.split(/\r?\n(?:[ \t]*\r?\n)+/).map(p => p.trim()).filter(Boolean)

  const pages: string[] = []
  let buffer: string[] = []
  let bufferLines = 0

  const flush = () => {
    if (!buffer.length) return
    pages.push(buffer.join('\n\n'))
    buffer = []
    bufferLines = 0
  }

  for (const para of paragraphs) {
    const paraLines = measureTextWrap(para, box.width).lineCount

    if (paraLines > maxLines) {
      flush()
      for (const chunk of splitParagraph(para, box.width, maxLines)) {
        pages.push(chunk)
      }
      continue
    }

    // +1 line for the blank between two paragraphs on the same page.
    const cost = paraLines + (buffer.length ? 1 : 0)
    if (bufferLines + cost > maxLines) {
      flush()
      buffer.push(para)
      bufferLines = paraLines
    } else {
      buffer.push(para)
      bufferLines += cost
    }
  }
  flush()
  return pages
}

function splitParagraph(text: string, width: number, maxLines: number): string[] {
  const chunks: string[] = []
  let remaining = text.trim()

  while (remaining) {
    const points = Array.from(remaining)
    let low = 1
    let high = points.length
    let largestFit = 0

    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      const candidate = points.slice(0, middle).join('')
      const fitsBudget = candidate.length <= TEXT_UPGRADE_CHARACTER_LIMIT
      const fitsLines = fitsBudget && measureTextWrap(candidate, width).lineCount <= maxLines
      if (fitsLines) {
        largestFit = middle
        low = middle + 1
      } else {
        high = middle - 1
      }
    }

    if (largestFit === 0) {
      // A single Unicode code point should always fit the SDK character
      // budget. Preserve it rather than splitting a surrogate pair.
      largestFit = 1
    }

    let cut = largestFit
    if (largestFit < points.length) {
      for (let index = largestFit - 1; index > 0; index--) {
        if (/\s/u.test(points[index])) {
          cut = index
          break
        }
      }
    }

    const chunk = points.slice(0, cut).join('').trim()
    if (chunk) chunks.push(chunk)
    remaining = points.slice(cut).join('').trimStart()
  }
  return chunks
}
