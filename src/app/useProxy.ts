import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Services } from './services'
import type { Settings } from '../core/settings'
import type { CardData } from '../core/card/types'
import type { GreyImage, BitImage } from '../core/art/types'
import type { Geometry } from '../core/layout/fit'
import type { Printing } from '../data/scryfall'
import { normalizeScryfall } from '../core/card/normalize'
import { renderProxy } from '../core/render/renderProxy'
import { ArtUnavailable } from '../core/errors'
import { getPreferredArt, setPreferredArt } from '../core/art/preference'
import { ensureFonts } from './browserEnv'
import { resolveArt } from './resolveArt'

export type ProxyState = 'idle' | 'loading' | 'rendered' | 'error'
export const PRINTS_ERROR = 'Could not load other printings.'

export function useProxy(services: Services, settings: Settings) {
  const [state, setState] = useState<ProxyState>('idle')
  const [card, setCard] = useState<CardData | null>(null)
  const [art, setArt] = useState<GreyImage | null>(null)
  const [artFailed, setArtFailed] = useState(false)
  const [artRef, setArtRef] = useState<string | null>(null)
  const [bits, setBits] = useState<BitImage | null>(null)
  const [geometry, setGeometry] = useState<Geometry | null>(null)
  const [errors, setErrors] = useState<Error[]>([])
  const [fontError, setFontError] = useState<Error | null>(null)
  const [prints, setPrints] = useState<Printing[] | null>(null)
  const [printsError, setPrintsError] = useState<string | null>(null)
  const seq = useRef(0)

  const render = useCallback(async (name: string) => {
    const my = ++seq.current
    setState('loading'); setErrors([]); setPrints(null); setPrintsError(null)
    try {
      const c = normalizeScryfall(await services.client.fetchCard(name))
      const r = await resolveArt(services, c)
      if (my !== seq.current) return
      setCard(c); setArt(r.art); setArtFailed(r.failed); setArtRef(getPreferredArt(services.storage, c.name)); setState('rendered')
    } catch (e) {
      if (my !== seq.current) return
      setCard(null); setArt(null); setArtFailed(false); setArtRef(null); setBits(null); setGeometry(null)
      setErrors([e instanceof Error ? e : new Error(String(e))]); setState('error')
    }
  }, [services])

  /** Remember a printing for this card name (null = default art) and reload the art. */
  const chooseArt = useCallback(async (ref: string | null) => {
    if (!card) return
    setPreferredArt(services.storage, card.name, ref)
    setArtRef(ref)
    const my = seq.current
    const r = await resolveArt(services, card)
    if (my !== seq.current) return
    setArt(r.art); setArtFailed(r.failed)
  }, [services, card])

  const loadPrints = useCallback(async () => {
    if (!card) return
    setPrints(null); setPrintsError(null)
    try { setPrints(await services.client.fetchPrints(card.name)) }
    catch { setPrintsError(PRINTS_ERROR) }
  }, [services, card])

  // Re-render whenever the card, art or settings change.
  useEffect(() => {
    if (!card) return
    let on = true
    const draw = (fontError: Error | null) => {
      if (!on) return
      setFontError(fontError)
      const r = renderProxy(card, art, settings, services.env)
      setBits(r.bits); setGeometry(r.geometry)
    }
    // A missing font (e.g. MPlantin without the local file) must not stall rendering: fall back and warn.
    ensureFonts(settings.fontFamily).then(
      () => draw(null),
      () => draw(new Error(`Font ${settings.fontFamily} could not be loaded; rendering with a fallback font.`)),
    )
    return () => { on = false }
  }, [card, art, settings, services.env])

  const allErrors = useMemo(
    () => [...errors, ...(artFailed ? [new ArtUnavailable()] : []), ...(fontError ? [fontError] : [])],
    [errors, artFailed, fontError],
  )

  return { state, card, bits, geometry, errors: allErrors, render, artRef, chooseArt, prints, printsError, loadPrints }
}
