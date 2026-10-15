import { normalizeName } from '../../data/fuzzy'

export interface DeckEntry { line: number; count: number; name: string }
export interface ParseIssue { kind: 'bad-count'; line: number; text: string }
export interface ParsedDeck { entries: DeckEntry[]; issues: ParseIssue[]; moxfieldUrl: string | null }
export interface DistinctEntry { key: string; name: string; count: number; line: number }

const HEADER = /^(deck|mainboard|main|commander|commanders|companion|sideboard|maybeboard|considering|tokens):?$/i
const SKIP_HEADERS = new Set(['sideboard', 'maybeboard', 'considering', 'tokens'])
const MOXFIELD = /https?:\/\/(?:www\.)?moxfield\.com\/decks\/[A-Za-z0-9_-]+/
const COUNT = /^(\d+)\s*[xX]?\s+(\S.*)$/
const FINISH_FLAGS = /(\s+\*[A-Za-z]\*)+$/
const SET_SUFFIX = /\s+\([A-Za-z0-9]{2,6}\)(\s+[A-Za-z0-9★-]+)?$/   // collector numbers: 263, 240a, 1★, C21-263 (The List)

const splitLines = (text: string) => text.split('\n').map((l) => l.replace(/\r$/, ''))

/** Count and name of a card line, or null when the line is blank, a comment, a header or a URL. */
function parseLine(raw: string): { count: number | null; name: string } | null {
  const t = raw.trim()
  if (!t || t.startsWith('//') || t.startsWith('#') || HEADER.test(t) || MOXFIELD.test(t)) return null
  const m = COUNT.exec(t)
  const count = m ? Number(m[1]) : null
  const rest = (m ? m[2] : t).replace(FINISH_FLAGS, '').replace(SET_SUFFIX, '').trim()
  return { count, name: rest }
}

export function parseDeckList(text: string): ParsedDeck {
  const entries: DeckEntry[] = []
  const issues: ParseIssue[] = []
  let moxfieldUrl: string | null = null
  let skipping = false
  splitLines(text).forEach((raw, i) => {
    const line = i + 1
    const t = raw.trim()
    const url = MOXFIELD.exec(t)
    if (url) { moxfieldUrl = url[0]; return }
    const header = HEADER.exec(t)
    if (header) { skipping = SKIP_HEADERS.has(header[1].toLowerCase()); return }
    if (skipping) return
    const parsed = parseLine(raw)
    if (!parsed) return
    const count = parsed.count ?? 1
    if (count < 1 || count > 99) { issues.push({ kind: 'bad-count', line, text: t }); return }
    entries.push({ line, count, name: parsed.name })
  })
  return { entries, issues, moxfieldUrl }
}

/** Sum counts per card, comparing names case- and accent-insensitively; first appearance wins the spelling and line. */
export function distinctCards(entries: DeckEntry[]): DistinctEntry[] {
  const out: DistinctEntry[] = []
  const byKey = new Map<string, DistinctEntry>()
  for (const e of entries) {
    const key = normalizeName(e.name)
    const hit = byKey.get(key)
    if (hit) hit.count += e.count
    else { const d = { key, name: e.name, count: e.count, line: e.line }; byKey.set(key, d); out.push(d) }
  }
  return out
}

/** Rewrite every entry line whose name matches `oldName` to `<count> <newName>` (count kept only when it was written). Normalises line endings to LF. */
export function rewriteCardName(text: string, oldName: string, newName: string): string {
  const target = normalizeName(oldName)
  const lines = splitLines(text)
  const entryLines = new Set(parseDeckList(text).entries.filter((e) => normalizeName(e.name) === target).map((e) => e.line))
  return lines.map((raw, i) => {
    if (!entryLines.has(i + 1)) return raw
    const parsed = parseLine(raw)
    return parsed?.count != null ? `${parsed.count} ${newName}` : newName
  }).join('\n')
}

/** The trimmed text of a 1-based line, "" when out of range. */
export function lineText(text: string, line: number): string {
  return (splitLines(text)[line - 1] ?? '').trim()
}
