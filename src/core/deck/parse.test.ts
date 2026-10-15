import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseDeckList, distinctCards, rewriteCardName, lineText } from './parse'

const fixture = (n: string) => readFileSync(`tests/fixtures/decks/${n}.txt`, 'utf8')
const names = (text: string) => parseDeckList(text).entries.map((e) => `${e.count} ${e.name}`)

describe('parseDeckList', () => {
  it('reads counts with and without x, defaulting to 1', () => {
    expect(names('4 Lightning Bolt\n2x Mountain\n3X Forest\nTarmogoyf')).toEqual(['4 Lightning Bolt', '2 Mountain', '3 Forest', '1 Tarmogoyf'])
  })
  it('strips set and collector suffixes, including letters and stars', () => {
    expect(names('1 Sol Ring (C21) 263\n1 Forest (UNF) 240a\n1 Island (SLD) 1★\n1 Opt (ELD)')).toEqual(['1 Sol Ring', '1 Forest', '1 Island', '1 Opt'])
  })
  it('strips set suffixes whose collector number has a hyphen (The List)', () => {
    expect(names('1 Sol Ring (PLST) C21-263\n1 Opt (PLST) ELD-59 *F*')).toEqual(['1 Sol Ring', '1 Opt'])
  })
  it('strips Moxfield finish markers', () => {
    expect(names('1 Sol Ring (C21) 263 *F*\n1 Opt *E*')).toEqual(['1 Sol Ring', '1 Opt'])
  })
  it('skips blank lines and comments, keeps 1-based line numbers', () => {
    const p = parseDeckList('// my deck\n\n# lands\n4 Mountain')
    expect(p.entries).toEqual([{ line: 4, count: 4, name: 'Mountain' }])
  })
  it('skips every header spelling and prints Commander cards', () => {
    const text = 'Deck\n1 A\nMainboard:\n1 B\nMain\n1 C\nCommander\n1 D\nCommanders:\n1 E\nCompanion\n1 F'
    expect(names(text)).toEqual(['1 A', '1 B', '1 C', '1 D', '1 E', '1 F'])
  })
  it('enters skip mode on Sideboard, Maybeboard, Considering and Tokens, and leaves it on Deck', () => {
    const text = '1 A\nSideboard\n1 S1\nMaybeboard\n1 M1\nDeck\n1 B\nConsidering:\n1 C1\nTokens\n1 T1\nMainboard\n1 C'
    expect(names(text)).toEqual(['1 A', '1 B', '1 C'])
  })
  it('does not treat a blank line as a sideboard separator (MTGO text prints everything)', () => {
    expect(names(fixture('mtgo'))).toEqual(['4 Lightning Bolt', '20 Mountain', '4 Spell Pierce'])
  })
  it('parses the Moxfield export without its sideboard', () => {
    const p = parseDeckList(fixture('moxfield'))
    expect(p.entries.map((e) => e.name)).toEqual(['Magda, Brazen Outlaw', 'Mountain', 'Sol Ring', "Lim-Dûl's Vault"])
    expect(p.entries[1].count).toBe(21)
  })
  it('parses the Arena export without its sideboard', () => {
    expect(names(fixture('arena'))).toEqual(['4 Lightning Bolt', '4 Delver of Secrets'])
  })
  it('parses plain names', () => {
    expect(names(fixture('plain'))).toEqual(['1 Lightning Bolt', '1 Tarmogoyf', '1 Nicol Bolas, the Ravager'])
  })
  it('keeps double-faced names whole', () => {
    expect(names('1 Delver of Secrets // Insectile Aberration')).toEqual(['1 Delver of Secrets // Insectile Aberration'])
  })
  it('reports counts of 0 or above 99 as bad-count issues and drops the entry', () => {
    const p = parseDeckList('0 Mountain\n100 Forest\n99 Island')
    expect(p.issues).toEqual([{ kind: 'bad-count', line: 1, text: '0 Mountain' }, { kind: 'bad-count', line: 2, text: '100 Forest' }])
    expect(names('0 Mountain\n100 Forest\n99 Island')).toEqual(['99 Island'])
  })
  it('detects a Moxfield URL and does not treat it as a card', () => {
    const p = parseDeckList('https://moxfield.com/decks/b4VMi7ZsdUOcDNFXxctNsQ\n1 Mountain')
    expect(p.moxfieldUrl).toBe('https://moxfield.com/decks/b4VMi7ZsdUOcDNFXxctNsQ')
    expect(p.entries.length).toBe(1)
    expect(parseDeckList('1 Mountain').moxfieldUrl).toBeNull()
  })
  it('handles Windows line endings', () => {
    const p = parseDeckList('4 Lightning Bolt\r\n2 Mountain\r\n')
    expect(p.entries).toEqual([{ line: 1, count: 4, name: 'Lightning Bolt' }, { line: 2, count: 2, name: 'Mountain' }])
  })
})

describe('distinctCards', () => {
  it('sums counts per name, folding case and accents, keeping first-appearance order and line', () => {
    const p = parseDeckList("2 Lightning Bolt\n1 Lim-Dûl's Vault\n2 lightning bolt\n1 Lim-Dul's Vault")
    expect(distinctCards(p.entries)).toEqual([
      { key: 'lightning bolt', name: 'Lightning Bolt', count: 4, line: 1 },
      { key: "lim-dul's vault", name: "Lim-Dûl's Vault", count: 2, line: 2 },
    ])
  })
})

describe('rewriteCardName', () => {
  it('replaces the name on every line that has it, keeping the count and dropping suffixes', () => {
    const text = '4 Lightnin Bolt (STA) 42\n2 Mountain\nlightnin bolt *F*'
    expect(rewriteCardName(text, 'Lightnin Bolt', 'Lightning Bolt')).toBe('4 Lightning Bolt\n2 Mountain\nLightning Bolt')
  })
  it('keeps the other lines, headers and comments byte for byte, and normalises CRLF to LF', () => {
    const text = '// note\r\nDeck\r\n1 Lightnin Bolt\r\n\r\nSideboard\r\n1 Lightnin Bolt'
    expect(rewriteCardName(text, 'Lightnin Bolt', 'Lightning Bolt')).toBe('// note\nDeck\n1 Lightning Bolt\n\nSideboard\n1 Lightnin Bolt')
  })
})

describe('lineText', () => {
  it('returns the trimmed text of a 1-based line, or "" when out of range', () => {
    expect(lineText('a\n  b  \r\nc', 2)).toBe('b')
    expect(lineText('a', 5)).toBe('')
  })
})
