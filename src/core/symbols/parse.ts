import { MANA_PATHS } from '../../assets/mana/paths'

export type SymbolSpec =
  | { kind: 'glyph'; glyph: string }
  | { kind: 'hybrid'; a: string; b: string }
  | { kind: 'phyrexian'; color: string }
  | { kind: 'text'; text: string }

const ALIASES: Record<string, string> = { t: 'tap', q: 'untap', '½': 'half', '∞': 'infinity', chaos: 'chaos' }

function glyphFor(part: string): string | undefined {
  const key = ALIASES[part] ?? part
  return key in MANA_PATHS ? key : undefined
}

/** Interpret the text inside a Scryfall {…} symbol. Never throws. */
export function parseSymbol(code: string): SymbolSpec {
  const lower = code.toLowerCase()
  const parts = lower.split('/')
  if (parts.length >= 2 && parts[parts.length - 1] === 'p') {
    const color = glyphFor(parts[0])
    if (color) return { kind: 'phyrexian', color }
  }
  if (parts.length === 2) {
    const a = glyphFor(parts[0]), b = glyphFor(parts[1])
    if (a && b) return { kind: 'hybrid', a, b }
  }
  const g = glyphFor(lower)
  if (g) return { kind: 'glyph', glyph: g }
  return { kind: 'text', text: code }
}
