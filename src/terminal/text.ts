import stringWidth from 'string-width'

export function displayWidth(text: string): number {
  return stringWidth(text)
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function graphemes(text: string): string[] {
  return [...segmenter.segment(text)].map(part => part.segment)
}

export function wrapLabel(text: string, columns: number): string[] {
  return text.split(/\n|\\n/).flatMap(line => {
    const result: string[] = []
    let current = ''
    for (const character of graphemes(line)) {
      if (current && stringWidth(current + character) > columns) {
        result.push(current.trimEnd())
        current = ''
      }
      current += character
    }
    result.push(current.trimEnd())
    return result
  })
}
