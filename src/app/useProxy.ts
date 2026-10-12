import { useCallback, useEffect, useRef, useState } from 'react'
import type { Services } from './services'
import type { Settings } from '../core/settings'
import type { CardData } from '../core/card/types'
import type { GreyImage, BitImage } from '../core/art/types'
import type { Geometry } from '../core/layout/fit'
import { normalizeScryfall } from '../core/card/normalize'
import { renderProxy } from '../core/render/renderProxy'
import { ArtUnavailable } from '../core/errors'
import { ensureFonts } from './browserEnv'

export type ProxyState = 'idle' | 'loading' | 'rendered' | 'error'

export function useProxy(services: Services, settings: Settings) {
  const [state, setState] = useState<ProxyState>('idle')
  const [card, setCard] = useState<CardData | null>(null)
  const [art, setArt] = useState<GreyImage | null>(null)
  const [bits, setBits] = useState<BitImage | null>(null)
  const [geometry, setGeometry] = useState<Geometry | null>(null)
  const [errors, setErrors] = useState<Error[]>([])
  const seq = useRef(0)

  const render = useCallback(async (name: string) => {
    const my = ++seq.current
    setState('loading'); setErrors([])
    try {
      const raw = await services.client.fetchCard(name)
      const c = normalizeScryfall(raw)
      let g: GreyImage | null = null
      const soft: Error[] = []
      if (c.artUrl) {
        try { g = await services.decodeArt(await services.client.fetchArtBlob(c.artUrl)) }
        catch { soft.push(new ArtUnavailable()) }
      }
      if (my !== seq.current) return
      setCard(c); setArt(g); setErrors(soft); setState('rendered')
    } catch (e) {
      if (my !== seq.current) return
      setCard(null); setArt(null); setBits(null); setGeometry(null)
      setErrors([e instanceof Error ? e : new Error(String(e))]); setState('error')
    }
  }, [services])

  // Re-render whenever the card, art or settings change.
  useEffect(() => {
    if (!card) return
    let on = true
    ensureFonts(settings.fontFamily).then(() => {
      if (!on) return
      const r = renderProxy(card, art, settings, services.env)
      setBits(r.bits); setGeometry(r.geometry)
    })
    return () => { on = false }
  }, [card, art, settings, services.env])

  return { state, card, bits, geometry, errors, render }
}
