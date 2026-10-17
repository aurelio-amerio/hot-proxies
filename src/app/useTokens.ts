import { standardSheet } from '../core/card/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Services } from './services'
import type { Settings } from '../core/settings'
import type { TokenIndex, TokenEntry } from '../core/token/index'
import { tokenNames, variantsOf } from '../data/tokenIndex'
import { draftFromVariant, blankDraft, editDraft, normalizeDraft, type TokenDraft, type DraftPatch } from '../core/token/draft'
import type { Store } from '../core/art/preference'
import type { GreyImage, BitImage } from '../core/art/types'
import type { Geometry } from '../core/layout/fit'
import { renderProxy } from '../core/render/renderProxy'
import { escposInit } from '../core/output/escpos'
import { sheetFrames } from '../core/printer/sheets'
import { FEED_LINES_AFTER, FEED_LINES_BETWEEN_CARDS } from '../core/printer'
import { printJob, type PrinterState } from '../core/printer/transport'
import { ensureFonts } from './browserEnv'
import { fontFallbackMessage } from './fontFallback'
import { PRINTER_MESSAGES } from './usePrinter'

export const TOKEN_DRAFT_KEY = 'hot-proxies.token.v1'
export const TOKEN_INDEX_ERROR = 'Token list unavailable.'

function loadDraft(store: Store): TokenDraft | null {
  try { return normalizeDraft(JSON.parse(store.getItem(TOKEN_DRAFT_KEY) ?? 'null')) } catch { return null }
}

/** Tokens mode: one editable draft, its art, its render, and printing N copies in one job. */
export function useTokens(services: Services, settings: Settings) {
  const [index, setIndex] = useState<TokenIndex | null>(null)
  const [indexError, setIndexError] = useState<string | null>(null)
  const [draft, setDraftState] = useState<TokenDraft | null>(() => loadDraft(services.storage))
  const [touched, setTouched] = useState(false)
  /** Art as loaded, tagged with the ref it belongs to so a stale image never reaches the render. */
  const [loaded, setLoaded] = useState<{ ref: string; art: GreyImage | null; failed: boolean } | null>(null)
  const [bits, setBits] = useState<BitImage | null>(null)
  const [geometry, setGeometry] = useState<Geometry | null>(null)
  const [fontError, setFontError] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [printError, setPrintError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const artSeq = useRef(0)

  useEffect(() => {
    let on = true
    services.loadTokens().then((i) => { if (on) setIndex(i) }, () => { if (on) setIndexError(TOKEN_INDEX_ERROR) })
    return () => { on = false }
  }, [services])

  const persist = useCallback((d: TokenDraft | null) => {
    try { services.storage.setItem(TOKEN_DRAFT_KEY, JSON.stringify(d)) } catch { /* storage full or disabled: keep in memory */ }
  }, [services.storage])
  const setDraft = useCallback((d: TokenDraft | null) => { setDraftState(d); persist(d) }, [persist])

  const loadNames = useCallback(() => services.loadTokens().then(tokenNames), [services])
  const entry = useMemo<TokenEntry | null>(() => (index && draft?.base ? variantsOf(index, draft.base.name) ?? null : null), [index, draft])

  const pickToken = useCallback((name: string) => {
    if (!index) return
    const e = variantsOf(index, name)
    if (!e) return
    setTouched(false); setDraft(draftFromVariant(e, 0))
  }, [index, setDraft])
  const pickVariant = useCallback((i: number) => { if (entry) { setTouched(false); setDraft(draftFromVariant(entry, i)) } }, [entry, setDraft])
  const startBlank = useCallback(() => { setTouched(false); setDraft(blankDraft()) }, [setDraft])
  /** Functional update so two edits in one tick both land. */
  const edit = useCallback((p: DraftPatch) => {
    if (!('copies' in p)) setTouched(true)
    setDraftState((prev) => {
      if (!prev) return prev
      const next = editDraft(prev, p)
      persist(next)
      return next
    })
  }, [persist])

  // Art follows the draft's art ref; until the new ref's art arrives the card renders without art.
  const ref = draft?.artRef ?? null
  useEffect(() => {
    const my = ++artSeq.current
    if (!ref) { setLoaded(null); return }
    services.client.fetchArtById(ref).then(services.decodeArt).then(
      (g) => { if (my === artSeq.current) setLoaded({ ref, art: g, failed: false }) },
      () => { if (my === artSeq.current) setLoaded({ ref, art: null, failed: true }) },
    )
  }, [ref, services])
  const current = loaded && loaded.ref === ref ? loaded : null
  const art = current?.art ?? null
  const artFailed = current?.failed ?? false

  // Re-render whenever the card, art or settings change.
  const card = draft?.card ?? null
  useEffect(() => {
    if (!card) { setBits(null); setGeometry(null); return }
    let on = true
    const draw = (err: string | null) => {
      if (!on) return
      setFontError(err)
      const r = renderProxy(standardSheet(card), art, settings, services.env)
      setBits(r.bits); setGeometry(r.geometry)
    }
    ensureFonts(settings.fontFamily).then(
      () => draw(null),
      () => draw(fontFallbackMessage(settings.fontFamily)),
    )
    return () => { on = false }
  }, [card, art, settings, services.env])

  /** One job: ESC @, then per copy the sheet frames with a gap feed; the last copy gets the tail feed. */
  const print = useCallback(async () => {
    const printer = services.printer
    if (!bits || !draft || printer.state !== 'connected') return
    setPrinting(true); setPrintError(null); setProgress(0)
    const frames: Uint8Array[] = [escposInit()]
    for (let i = 0; i < draft.copies; i++) {
      frames.push(...sheetFrames([bits], i === draft.copies - 1 ? FEED_LINES_AFTER : FEED_LINES_BETWEEN_CARDS))
    }
    const ac = new AbortController(); abort.current = ac
    try {
      await printJob(printer, frames, { signal: ac.signal, onProgress: (sent, total) => setProgress(total ? sent / total : 0) })
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setPrintError((printer.state as PrinterState) === 'disconnected' ? PRINTER_MESSAGES.dropped : (e instanceof Error ? e.message : String(e)))
      }
    } finally {
      abort.current = null; setPrinting(false); setProgress(0)
    }
  }, [services.printer, bits, draft])

  const cancel = useCallback(() => { abort.current?.abort() }, [])
  const clearPrintError = useCallback(() => setPrintError(null), [])

  return { index, indexError, draft, entry, bits, geometry, artFailed, fontError, touched, loadNames, pickToken, pickVariant, startBlank, edit, printing, progress, print, cancel, printError, clearPrintError }
}

export type UseTokens = ReturnType<typeof useTokens>
