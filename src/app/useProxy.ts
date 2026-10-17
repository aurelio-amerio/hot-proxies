import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Services } from './services'
import type { Settings } from '../core/settings'
import type { ProxyCard } from '../core/card/types'
import type { BitImage } from '../core/art/types'
import type { Geometry } from '../core/layout/fit'
import type { Printing } from '../data/scryfall'
import { renderProxy } from '../core/render/renderProxy'
import { ArtUnavailable, MeldUnavailable } from '../core/errors'
import { getPreferredArt, setPreferredArt } from '../core/art/preference'
import { ensureFonts } from './browserEnv'
import { fontFallbackMessage } from './fontFallback'
import { loadCard } from './loadCard'
import { resolveArt, type ResolvedArt } from './resolveArt'

export type ProxyState = 'idle' | 'loading' | 'rendered' | 'error'
export const PRINTS_ERROR = 'Could not load other printings.'

export interface SheetRender { bits: BitImage; geometry: Geometry }

/** Card mode: one card, the art for each of its sheets, and one render per sheet. */
export function useProxy(services: Services, settings: Settings) {
  const [state, setState] = useState<ProxyState>('idle')
  const [card, setCard] = useState<ProxyCard | null>(null)
  const [arts, setArts] = useState<ResolvedArt[]>([])
  const [meldFailed, setMeldFailed] = useState(false)
  const [artRef, setArtRef] = useState<string | null>(null)
  const [renders, setRenders] = useState<SheetRender[]>([])
  const [errors, setErrors] = useState<Error[]>([])
  const [fontError, setFontError] = useState<Error | null>(null)
  const [prints, setPrints] = useState<Printing[] | null>(null)
  const [printsError, setPrintsError] = useState<string | null>(null)
  const seq = useRef(0)
  /** Art loads have their own sequence: a newer pick or render drops an older load's result. */
  const artSeq = useRef(0)

  const render = useCallback(async (name: string) => {
    const my = ++seq.current
    ++artSeq.current
    setState('loading'); setErrors([]); setPrints(null); setPrintsError(null)
    try {
      const loaded = await loadCard(services, name)
      const a = await resolveArt(services, loaded.card)
      if (my !== seq.current) return
      setCard(loaded.card); setMeldFailed(loaded.meldFailed); setArts(a)
      setArtRef(getPreferredArt(services.storage, loaded.card.name)); setState('rendered')
    } catch (e) {
      if (my !== seq.current) return
      setCard(null); setArts([]); setMeldFailed(false); setArtRef(null); setRenders([])
      setErrors([e instanceof Error ? e : new Error(String(e))]); setState('error')
    }
  }, [services])

  /** Remember a printing for this card name (null = default art) and reload the art of every sheet. */
  const chooseArt = useCallback(async (ref: string | null) => {
    if (!card) return
    setPreferredArt(services.storage, card.name, ref)
    setArtRef(ref)
    const my = ++artSeq.current
    const a = await resolveArt(services, card)
    if (my !== artSeq.current) return
    setArts(a)
  }, [services, card])

  const loadPrints = useCallback(async () => {
    if (!card) return
    setPrints(null); setPrintsError(null)
    try { setPrints(await services.client.fetchPrints(card.name)) }
    catch { setPrintsError(PRINTS_ERROR) }
  }, [services, card])

  // Re-render every sheet whenever the card, art or settings change.
  useEffect(() => {
    if (!card) return
    let on = true
    const draw = (fontError: Error | null) => {
      if (!on) return
      setFontError(fontError)
      setRenders(card.sheets.map((sheet, i) => {
        const r = renderProxy(sheet, arts[i]?.art ?? null, settings, services.env)
        return { bits: r.bits, geometry: r.geometry }
      }))
    }
    // A missing font (e.g. MPlantin without the local file) must not stall rendering: fall back and warn.
    ensureFonts(settings.fontFamily).then(
      () => draw(null),
      () => draw(new Error(fontFallbackMessage(settings.fontFamily))),
    )
    return () => { on = false }
  }, [card, arts, settings, services.env])

  const allErrors = useMemo(
    () => [
      ...errors,
      ...(meldFailed ? [new MeldUnavailable()] : []),
      ...(arts.some((a) => a.failed) ? [new ArtUnavailable()] : []),
      ...(fontError ? [fontError] : []),
    ],
    [errors, meldFailed, arts, fontError],
  )

  return { state, card, renders, errors: allErrors, render, artRef, chooseArt, prints, printsError, loadPrints }
}
