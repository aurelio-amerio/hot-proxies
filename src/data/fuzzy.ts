export function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/æ/gi, 'ae').toLowerCase().trim()
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  return out
}
function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let hit = 0
  for (const x of a) if (b.has(x)) hit++
  return (2 * hit) / (a.size + b.size)
}

/** Keep one entry per full name, with its best score. */
function addBest(scored: { name: string; score: number }[], name: string, score: number): void {
  const prev = scored.find((s) => s.name === name)
  if (!prev) scored.push({ name, score })
  else if (score > prev.score) prev.score = score
}

export interface Matcher { search(query: string, limit?: number): string[] }

/** Ranked name lookup: prefix (3) > word prefix (2) > substring (1) > bigram similarity (0..1).
 *  Each half of a multi-face name ("A // B") is also an alias that resolves to the full name. */
export function createMatcher(names: string[]): Matcher {
  const entries = names.flatMap((name) => {
    const norm = normalizeName(name)
    const halves = norm.includes(' // ') ? norm.split(' // ') : []
    return [norm, ...halves].map((n) => ({ name, norm: n, grams: null as Set<string> | null }))
  })
  return {
    search(query, limit = 8) {
      const q = normalizeName(query)
      if (!q) return []
      const scored: { name: string; score: number }[] = []
      for (const e of entries) {
        let score = 0
        if (e.norm.startsWith(q)) score = 3
        else if (e.norm.includes(' ' + q)) score = 2
        else if (e.norm.includes(q)) score = 1
        if (score) addBest(scored, e.name, score)
      }
      if (scored.length < limit && q.length >= 4) {
        const qg = bigrams(q)
        for (const e of entries) {
          if (!e.grams) e.grams = bigrams(e.norm)
          const d = dice(qg, e.grams)
          if (d >= 0.5 && !scored.some((s) => s.name === e.name)) scored.push({ name: e.name, score: d })
        }
      }
      scored.sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.name.localeCompare(b.name))
      return scored.slice(0, limit).map((s) => s.name)
    },
  }
}
