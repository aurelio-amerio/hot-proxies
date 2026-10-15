import { useCallback, useMemo, useRef, useState } from 'react'
import type { Services } from './services'
import type { Settings } from '../core/settings'
import { parseDeckList, distinctCards, rewriteCardName, lineText, type ParsedDeck, type DistinctEntry } from '../core/deck/parse'
import { createRun, type DeckCard, type DeckRun } from '../core/deck/run'
import { normalizeScryfall } from '../core/card/normalize'
import { CardNotFound, NetworkError, UnsupportedLayout } from '../core/errors'
import { createMatcher, type Matcher } from '../data/fuzzy'
import type { GreyImage } from '../core/art/types'

export type DeckState = 'editing' | 'verifying' | 'ready' | 'printing' | 'paused' | 'done'
export type DeckIssue =
  | { kind: 'not-found'; line: number; text: string; name: string; suggestion: string | null }
  | { kind: 'unsupported-layout'; line: number; text: string; name: string; layout: string }
  | { kind: 'bad-count'; line: number; text: string }

export const DECK_TEXT_KEY = 'hot-proxies.deck.v1'
type Store = Pick<Storage, 'getItem' | 'setItem'>
const loadText = (s: Store) => { try { return s.getItem(DECK_TEXT_KEY) ?? '' } catch { return '' } }

export function useDeck(services: Services, settings: Settings) {
  void settings   // used by the thumbnail renderer added in the next task
  const [state, setState] = useState<DeckState>('editing')
  const [text, setTextState] = useState(() => loadText(services.storage))
  const [issues, setIssues] = useState<DeckIssue[] | null>(null)
  const [verifyProgress, setVerifyProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [run, setRunState] = useState<DeckRun | null>(null)
  const runRef = useRef<DeckRun | null>(null)
  const stateRef = useRef<DeckState>('editing')
  const seq = useRef(0)

  const parsed = useMemo<ParsedDeck>(() => parseDeckList(text), [text])
  const distinct = useMemo<DistinctEntry[]>(() => distinctCards(parsed.entries), [parsed])

  const go = useCallback((s: DeckState) => { stateRef.current = s; setState(s) }, [])
  const setRun = useCallback((r: DeckRun | null) => { runRef.current = r; setRunState(r) }, [])

  /** Persist text without touching verify state (used by suggestion rewrites). */
  const commitText = useCallback((v: string) => {
    setTextState(v)
    try { services.storage.setItem(DECK_TEXT_KEY, v) } catch { /* storage full or disabled: keep in memory */ }
  }, [services.storage])

  /** Text area edits: discard any run or verify result. Ignored while verifying or printing (the field is read-only then). */
  const setText = useCallback((v: string) => {
    if (stateRef.current === 'verifying' || stateRef.current === 'printing') return
    seq.current++
    commitText(v); setRun(null); setIssues(null); setVerifyProgress(null); go('editing')
  }, [commitText, setRun, go])

  const verify = useCallback(async () => {
    if (stateRef.current === 'verifying' || stateRef.current === 'printing') return
    const my = ++seq.current
    const snapshotText = text
    go('verifying'); setError(null); setIssues(null); setRun(null)
    setVerifyProgress({ done: 0, total: distinct.length })
    const found: DeckIssue[] = parsed.issues.map((i) => ({ ...i }))
    const cards: DeckCard[] = []
    let matcher: Matcher | null | undefined
    const suggest = async (name: string): Promise<string | null> => {
      if (matcher === undefined) matcher = await services.loadNames().then((n) => createMatcher(n), () => null)
      return matcher ? matcher.search(name, 1)[0] ?? null : null
    }
    try {
      for (let i = 0; i < distinct.length; i++) {
        const d = distinct[i]
        try {
          const card = normalizeScryfall(await services.client.fetchCard(d.name))
          let art: GreyImage | null = null
          if (card.artUrl) { try { art = await services.decodeArt(await services.client.fetchArtBlob(card.artUrl)) } catch { art = null } }
          cards.push({ key: d.key, name: card.name, count: d.count, line: d.line, card, art })
        } catch (e) {
          const text = lineText(snapshotText, d.line)
          if (e instanceof CardNotFound) found.push({ kind: 'not-found', line: d.line, text, name: d.name, suggestion: await suggest(d.name) })
          else if (e instanceof UnsupportedLayout) found.push({ kind: 'unsupported-layout', line: d.line, text, name: d.name, layout: e.layout })
          else throw e
        }
        if (my !== seq.current) return
        setVerifyProgress({ done: i + 1, total: distinct.length })
      }
    } catch (e) {
      if (my !== seq.current) return
      setError(e instanceof NetworkError ? e.message : (e instanceof Error ? e.message : String(e)))
      setVerifyProgress(null); go('editing'); return
    }
    if (my !== seq.current) return
    setVerifyProgress(null)
    if (found.length) { found.sort((a, b) => a.line - b.line); setIssues(found); go('editing') }
    else { setRun(createRun(cards)); go('ready') }
  }, [text, parsed, distinct, services, go, setRun])

  const applySuggestion = useCallback((issue: Extract<DeckIssue, { kind: 'not-found' }>) => {
    if (!issue.suggestion) return
    commitText(rewriteCardName(text, issue.name, issue.suggestion))
    setIssues((prev) => { const rest = (prev ?? []).filter((i) => i.line !== issue.line); return rest.length ? rest : null })
  }, [text, commitText])

  const applyAllSuggestions = useCallback(() => {
    let next = text
    const fixed = new Set<number>()
    for (const i of issues ?? []) if (i.kind === 'not-found' && i.suggestion) { next = rewriteCardName(next, i.name, i.suggestion); fixed.add(i.line) }
    commitText(next)
    setIssues((prev) => { const rest = (prev ?? []).filter((i) => !fixed.has(i.line)); return rest.length ? rest : null })
  }, [text, issues, commitText])

  const closeIssues = useCallback(() => setIssues(null), [])
  const clearError = useCallback(() => setError(null), [])

  return { state, text, setText, parsed, distinct, issues, applySuggestion, applyAllSuggestions, closeIssues, verifyProgress, error, clearError, run, verify }
}

export type UseDeck = ReturnType<typeof useDeck>
