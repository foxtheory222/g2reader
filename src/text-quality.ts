// Conservative corruption gates shared by structured and page-based text
// extraction. They detect broken decoding without judging prose quality.
export const MAX_SINGLE_CHARACTER_RATIO = 0.8
export const MIN_CHARACTER_ENTROPY = 1.5
export const MAX_MOJIBAKE_PREFIX_RATIO = 0.05
const MIN_ENTROPY_SAMPLE = 64

export function hasMostlyGarbageText(text: string): boolean {
  let pointCount = 0
  let privateOrReplacement = 0
  let controls = 0
  let nonPrintable = 0
  let nonWhitespaceCount = 0
  let letters = 0
  let mojibakePrefixes = 0
  let previousCharacter = ''
  const frequencies = new Map<string, number>()

  for (const character of text) {
    pointCount += 1
    const codePoint = character.codePointAt(0) ?? 0
    if (
      codePoint === 0xfffd ||
      (codePoint >= 0xe000 && codePoint <= 0xf8ff) ||
      (codePoint >= 0xf0000 && codePoint <= 0xffffd) ||
      (codePoint >= 0x100000 && codePoint <= 0x10fffd)
    ) privateOrReplacement += 1

    const allowedWhitespace = character === '\n' || character === '\t'
    if (!allowedWhitespace && (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))) controls += 1
    if (!allowedWhitespace && /\p{C}/u.test(character)) nonPrintable += 1
    if (!/\s/u.test(character)) {
      nonWhitespaceCount += 1
      if (/\p{L}/u.test(character)) letters += 1
      frequencies.set(character, (frequencies.get(character) ?? 0) + 1)
    }

    if (
      ((previousCharacter === 'Ã' || previousCharacter === 'Â') && codePoint >= 0x80 && codePoint <= 0xbf) ||
      (previousCharacter === 'â' && /[€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/u.test(character))
    ) mojibakePrefixes += 1
    previousCharacter = character
  }

  if (!pointCount) return false
  if (privateOrReplacement / pointCount > 0.1) return true
  if (controls / pointCount > 0.02) return true
  if (nonPrintable / pointCount > 0.1) return true
  if (nonWhitespaceCount >= 12 && letters / nonWhitespaceCount < 0.2) return true

  if (nonWhitespaceCount >= MIN_ENTROPY_SAMPLE) {
    let largestFrequency = 0
    for (const frequency of frequencies.values()) largestFrequency = Math.max(largestFrequency, frequency)
    if (largestFrequency / nonWhitespaceCount > MAX_SINGLE_CHARACTER_RATIO) return true

    let entropy = 0
    for (const frequency of frequencies.values()) {
      const probability = frequency / nonWhitespaceCount
      entropy -= probability * Math.log2(probability)
    }
    if (entropy < MIN_CHARACTER_ENTROPY) return true
  }

  return mojibakePrefixes >= 2 && mojibakePrefixes / Math.max(1, nonWhitespaceCount) > MAX_MOJIBAKE_PREFIX_RATIO
}
