import type { Sheet } from '../card/types'
import type { Settings } from '../settings'
import type { RenderEnv } from '../env'
import type { GreyImage, BitImage } from '../art/types'
import { fit, type Geometry } from '../layout/fit'
import { prepareArt } from '../art/prepare'
import { StampCache } from '../symbols/stamp'
import { paint } from './paint'

const stampCaches = new WeakMap<RenderEnv, Map<string, StampCache>>()
function stampsFor(env: RenderEnv, family: string): StampCache {
  let byFamily = stampCaches.get(env)
  if (!byFamily) { byFamily = new Map(); stampCaches.set(env, byFamily) }
  let c = byFamily.get(family)
  if (!c) { c = new StampCache(env, family); byFamily.set(family, c) }
  return c
}

export const artInnerBox = (g: Geometry) => g.art ? { w: g.art.w - 4, h: g.art.h - 4 } : null

/** The one entry point the UI (and a future batch renderer) calls. Pure: same inputs, same bits. */
export function renderProxy(sheet: Sheet, art: GreyImage | null, settings: Settings, env: RenderEnv): { bits: BitImage; geometry: Geometry } {
  const geometry = fit(sheet, settings, env)
  const inner = artInnerBox(geometry)
  const artBits = art && inner ? prepareArt(art, inner, settings) : null
  const bits = paint(sheet, geometry, artBits, settings, env, stampsFor(env, settings.fontFamily))
  return { bits, geometry }
}
