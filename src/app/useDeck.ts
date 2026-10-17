import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Services } from './services'
import type { Settings } from '../core/settings'
import { parseDeckList, distinctCards, rewriteCardName, lineText, type ParsedDeck, type DistinctEntry } from '../core/deck/parse'
import { createRun, toggleCard as toggleRun, nextPending, markPrinted, progress, reset, type DeckCard, type DeckRun, type PrintItem } from '../core/deck/run'
import { normalizeScryfall } from '../core/card/normalize'
import { CardNotFound, NetworkError, UnsupportedLayout } from '../core/errors'
import { createMatcher, type Matcher } from '../data/fuzzy'
import type { BitImage } from '../core/art/types'
import { renderProxy } from '../core/render/renderProxy'
import { ensureFonts } from './browserEnv'
import { fontFallbackMessage } from './fontFallback'
import { toPacked } from '../core/output/packed'
import { escposInit, escposRasterFrames, escposFeed } from '../core/output/escpos'
import { FEED_LINES_AFTER, FEED_LINES_BETWEEN_CARDS } from '../core/printer'
import { printJob, type PrinterState } from '../core/printer/transport'
import { PRINTER_MESSAGES } from './usePrinter'
import { resolveArt } from './resolveArt'

export interface DeckThumb { bits: BitImage; overflow: boolean; artMissing: boolean }

export type DeckState = 'editing' | 'verifying' | 'ready' | 'printing' | 'paused' | 'done'
export type DeckIssue =
  | { kind: 'not-found'; line: number; text: string; name: string; suggestion: string | null }
  | { kind: 'unsupported-layout'; line: number; text: string; name: string; layout: string }
  | { kind: 'bad-count'; line: number; text: string }

export const DECK_TEXT_KEY = 'hot-proxies.deck.v1'
type Store = Pick<Storage, 'getItem' | 'setItem'>
const loadText = (s: Store) => { try { return s.getItem(DECK_TEXT_KEY) ?? '' } catch { return '' } }

export function useDeck(services: Services, settings: Settings) {
  const [state, setState] = useState<DeckState>('editing')
  const [text, setTextState] = useState(() => loadText(services.storage))
  const [issues, setIssues] = useState<DeckIssue[] | null>(null)
  const [verifyProgress, setVerifyProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [run, setRunState] = useState<DeckRun | null>(null)
  const runRef = useRef<DeckRun | null>(null)
  const stateRef = useRef<DeckState>('editing')
  const seq = useRef(0)
  const [thumbs, setThumbs] = useState<Map<string, DeckThumb>>(new Map())
  const [rendering, setRendering] = useState(false)
  const [fontWarning, setFontWarning] = useState<string | null>(null)
  const [current, setCurrent] = useState<{ item: PrintItem; fraction: number } | null>(null)
  const thumbsRef = useRef<Map<string, DeckThumb>>(new Map())
  const packedRef = useRef<Map<string, Uint8Array>>(new Map())
  const abort = useRef<AbortController | null>(null)
  /** ESC @ is due: a new run, Start over, or the connection dropped (the printer may have power-cycled). Never after raster data on the same connection: it clears the print buffer. */
  const needsInit = useRef(true)

  const parsed = useMemo<ParsedDeck>(() => parseDeckList(text), [text])
  const distinct = useMemo<DistinctEntry[]>(() => distinctCards(parsed.entries), [parsed])

  const go = useCallback((s: DeckState) => { stateRef.current = s; setState(s) }, [])
  const setRun = useCallback((r: DeckRun | null) => { runRef.current = r; setRunState(r) }, [])

  useEffect(() => services.printer.onStateChange((s) => { if (s === 'disconnected') needsInit.current = true }), [services.printer])

  // Render one BitImage per distinct card whenever the cards or settings change. Statuses are untouched.
  const cards = run?.cards ?? null
  useEffect(() => {
    if (!cards) return
    let on = true
    setRendering(true)
    const draw = async (fontError: Error | null) => {
      const next = new Map<string, DeckThumb>()
      for (let i = 0; i < cards.length; i++) {
        if (!on) return
        const c = cards[i]
        const r = renderProxy(c.card, c.art, settings, services.env)
        next.set(c.key, { bits: r.bits, overflow: r.geometry.overflow, artMissing: !!c.card.artUrl && !c.art })
        if (i % 4 === 3) await new Promise<void>((res) => setTimeout(res, 0))   // keep the UI responsive
      }
      if (!on) return
      thumbsRef.current = next; packedRef.current = new Map()
      setThumbs(next); setFontWarning(fontError ? fontError.message : null); setRendering(false)
    }
    ensureFonts(settings.fontFamily).then(
      () => draw(null),
      () => draw(new Error(fontFallbackMessage(settings.fontFamily))),
    )
    return () => { on = false }
  }, [cards, settings, services.env])

  /** Persist text without touching verify state (used by suggestion rewrites). */
  const commitText = useCallback((v: string) => {
    setTextState(v)
    try { services.storage.setItem(DECK_TEXT_KEY, v) } catch { /* storage full or disabled: keep in memory */ }
  }, [services.storage])

  /** Text area edits: discard any run or verify result. Ignored while verifying or printing (the field is read-only then). */
  const setText = useCallback((v: string) => {
    if (stateRef.current === 'verifying' || stateRef.current === 'printing') return
    seq.current++
    commitText(v); setRun(null); setIssues(null); setVerifyProgress(null)
    setThumbs(new Map()); thumbsRef.current = new Map(); packedRef.current = new Map()
    go('editing')
  }, [commitText, setRun, go])

  const verify = useCallback(async () => {
    if (stateRef.current === 'verifying' || stateRef.current === 'printing') return
    const my = ++seq.current
    const snapshotText = text
    go('verifying'); setError(null); setIssues(null); setRun(null)
    setThumbs(new Map()); thumbsRef.current = new Map(); packedRef.current = new Map()
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
          const { art } = await resolveArt(services, card)
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
    else { setRun(createRun(cards)); needsInit.current = true; go('ready') }
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

  const toggleCard = useCallback((key: string) => {
    if (stateRef.current === 'printing' || !runRef.current) return
    const next = toggleRun(runRef.current, key)
    setRun(next)
    // A started run follows what is left: re-ticking a card after "done" resumes, unticking the rest of a paused run finishes it.
    if (stateRef.current === 'paused' || stateRef.current === 'done') {
      go(nextPending(next) ? 'paused' : progress(next).printed > 0 ? 'done' : 'ready')
    }
  }, [setRun, go])

  const startOver = useCallback(() => {
    if (stateRef.current === 'printing' || !runRef.current) return
    setRun(reset(runRef.current)); needsInit.current = true; setError(null); go('ready')
  }, [setRun, go])

  const packedFor = (key: string): Uint8Array => {
    let p = packedRef.current.get(key)
    if (!p) { p = toPacked(thumbsRef.current.get(key)!.bits); packedRef.current.set(key, p) }
    return p
  }

  /** Print every pending item, in order. A run starts with ESC @; a resume repeats it only after a dropped connection. */
  const print = useCallback(async () => {
    const printer = services.printer
    const s = stateRef.current
    if ((s !== 'ready' && s !== 'paused') || !runRef.current || printer.state !== 'connected') return
    if (!nextPending(runRef.current) || thumbsRef.current.size !== runRef.current.cards.length) return
    go('printing'); setError(null)
    const ac = new AbortController(); abort.current = ac
    try {
      for (;;) {
        const run = runRef.current!
        const item = nextPending(run)
        if (!item) break
        const bits = thumbsRef.current.get(item.cardKey)!.bits
        const last = progress(run).remaining === 1
        const init = needsInit.current ? escposInit() : null
        const frames = [
          ...(init ? [init] : []),
          ...escposRasterFrames(packedFor(item.cardKey), bits.width, bits.height),
          escposFeed(last ? FEED_LINES_AFTER : FEED_LINES_BETWEEN_CARDS),
        ]
        setCurrent({ item, fraction: 0 })
        await printJob(printer, frames, { signal: ac.signal, onProgress: (sent, total) => {
          if (init && sent >= init.length) needsInit.current = false
          setCurrent({ item, fraction: total ? sent / total : 0 })
        } })
        setRun(markPrinted(runRef.current!, item))
      }
      go('done')
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setError((printer.state as PrinterState) === 'disconnected' ? PRINTER_MESSAGES.dropped : (e instanceof Error ? e.message : String(e)))
      }
      go('paused')
    } finally {
      abort.current = null; setCurrent(null)
    }
  }, [services.printer, go, setRun])

  const cancel = useCallback(() => { abort.current?.abort() }, [])

  return { state, text, setText, parsed, distinct, issues, applySuggestion, applyAllSuggestions, closeIssues, verifyProgress, error, clearError, run, verify, thumbs, rendering, fontWarning, current, toggleCard, print, cancel, startOver }
}

export type UseDeck = ReturnType<typeof useDeck>
