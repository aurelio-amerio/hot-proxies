import { describe, it, expect } from 'vitest'
import { getPreferredArt, setPreferredArt, ART_PREF_KEY } from './preference'

function store(init: Record<string, string> = {}) {
  const map = new Map(Object.entries(init))
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) } }
}

describe('art preference', () => {
  it('is empty by default and remembers a ref per card name', () => {
    const s = store()
    expect(getPreferredArt(s, 'Lightning Bolt')).toBeNull()
    setPreferredArt(s, 'Lightning Bolt', 'abc')
    expect(getPreferredArt(s, 'Lightning Bolt')).toBe('abc')
    expect(getPreferredArt(s, 'Forest')).toBeNull()
    expect(JSON.parse(s.map.get(ART_PREF_KEY)!)).toEqual({ 'Lightning Bolt': 'abc' })
  })
  it('removes the entry on null', () => {
    const s = store({ [ART_PREF_KEY]: JSON.stringify({ Forest: 'f', Island: 'i' }) })
    setPreferredArt(s, 'Forest', null)
    expect(getPreferredArt(s, 'Forest')).toBeNull()
    expect(getPreferredArt(s, 'Island')).toBe('i')
  })
  it('treats corrupt storage as empty and survives a throwing store', () => {
    expect(getPreferredArt(store({ [ART_PREF_KEY]: '{not json' }), 'Forest')).toBeNull()
    expect(getPreferredArt(store({ [ART_PREF_KEY]: '[1,2]' }), 'Forest')).toBeNull()
    const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(getPreferredArt(broken, 'Forest')).toBeNull()
    expect(() => setPreferredArt(broken, 'Forest', 'x')).not.toThrow()
  })
  it('does not answer inherited object keys as preferences', () => {
    expect(getPreferredArt(store(), 'constructor')).toBeNull()
    expect(getPreferredArt(store(), 'toString')).toBeNull()
  })
})
