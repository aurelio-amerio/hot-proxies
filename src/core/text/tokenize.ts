export type Token =
  | { kind: 'word'; text: string; glue: boolean }
  | { kind: 'symbol'; code: string; glue: boolean }
  | { kind: 'break' }

const CHUNK = /\{([^}]+)\}|([^{]+)/g

/** Split oracle text into words, {symbols} and paragraph breaks. `glue` = no space before this token. */
export function tokenize(text: string): Token[] {
  const out: Token[] = []
  const paragraphs = text.split('\n')
  paragraphs.forEach((para, pi) => {
    if (pi > 0) out.push({ kind: 'break' })
    for (const chunk of para.split(/\s+/)) {
      if (!chunk) continue
      let first = true
      for (const m of chunk.matchAll(CHUNK)) {
        const glue = !first
        if (m[1] !== undefined) out.push({ kind: 'symbol', code: m[1], glue })
        else out.push({ kind: 'word', text: m[2], glue })
        first = false
      }
    }
  })
  return out
}

/** "+3:", "−2:", "-1:", "0:" — a planeswalker ability prefix, used for hanging indents. */
export function isAbilityPrefix(text: string): boolean {
  return /^[+\-−]?\d+:$/.test(text)
}
