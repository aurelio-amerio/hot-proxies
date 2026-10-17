import type { Face, Section, Stat } from './types'

const SAGA = /^((?:[IVX]+)(?:, [IVX]+)*) — (.*)$/
const CLASS = /^(\{.*\}): Level (\d+)$/
const TO_SOLVE = /^To solve — (.*)$/
const SOLVED = /^Solved — (.*)$/
const LEVEL = /^LEVEL (\d+(?:-\d+|\+))$/
const LEVEL_STAT = /^(\d+|\*)\/(\d+|\*)$/
const PROTOTYPE = /^Prototype (\{.*\}) — (\S+)\/(\S+)(?: \((.*)\))?$/

/**
 * Paragraph-driven splitter. `open` returns the header (plus the first line of
 * text, if the header paragraph carries any) when a paragraph starts a new
 * section; every other paragraph is appended to the current section.
 */
function split(text: string, open: (p: string) => Omit<Section, 'text'> & { text?: string } | null): Section[] {
  const out: Section[] = []
  let cur: Section | null = null
  for (const p of text.split('\n')) {
    const head = open(p)
    if (head) {
      cur = { ...head, text: head.text ?? '' }
      out.push(cur)
    } else if (cur) {
      cur.text = cur.text ? `${cur.text}\n${p}` : p
    } else {
      cur = { text: p }
      out.push(cur)
    }
  }
  return out.filter((s) => s.header || s.badges || s.text !== '')
}

export function sagaSections(text: string): Section[] {
  return split(text, (p) => {
    const m = SAGA.exec(p)
    return m ? { badges: m[1].split(', '), text: m[2] } : null
  })
}

export function classSections(text: string): Section[] {
  return split(text, (p) => {
    const m = CLASS.exec(p)
    return m ? { header: { label: `Level ${m[2]}`, cost: m[1] } } : null
  })
}

export function caseSections(text: string): Section[] {
  return split(text, (p) => {
    const solve = TO_SOLVE.exec(p)
    if (solve) return { header: { label: 'To solve' }, text: solve[1] }
    const solved = SOLVED.exec(p)
    return solved ? { header: { label: 'Solved' }, text: solved[1] } : null
  })
}

export function levelerSections(text: string): Section[] {
  // The level's P/T paragraph follows its header; lift it into the header.
  const out = split(text, (p) => {
    const m = LEVEL.exec(p)
    return m ? { header: { label: p } } : null
  })
  for (const s of out) {
    if (!s.header) continue
    const [first, ...rest] = s.text.split('\n')
    const m = LEVEL_STAT.exec(first)
    if (!m) continue
    const stat: Stat = { kind: 'pt', power: m[1], toughness: m[2] }
    s.header.stat = stat
    s.text = rest.join('\n')
  }
  return out
}

/** null when paragraph 0 is not a Prototype line. */
export function prototypeFaces(face: Face): { main: Face; sub: Face } | null {
  const [first, ...rest] = face.oracleText.split('\n')
  const m = PROTOTYPE.exec(first)
  if (!m) return null
  return {
    main: { ...face, oracleText: rest.join('\n') },
    sub: {
      name: 'Prototype',
      manaCost: m[1],
      typeLine: '',
      oracleText: m[4] ? `(${m[4]})` : '',
      stat: { kind: 'pt', power: m[2], toughness: m[3] },
    },
  }
}
