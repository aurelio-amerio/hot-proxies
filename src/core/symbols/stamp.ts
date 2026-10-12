import type { RenderEnv, CanvasLike, Ctx2D } from '../env'
import { MANA_PATHS, MANA_VIEWBOX } from '../../assets/mana/paths'
import { parseSymbol } from './parse'

export interface Stamp { size: number; canvas: CanvasLike }

const OUTLINE = 2

export class StampCache {
  private cache = new Map<string, Stamp>()
  constructor(private env: RenderEnv, private fontFamily: string) {}

  get(code: string, size: number): Stamp {
    const key = `${code}@${size}`
    let s = this.cache.get(key)
    if (!s) { s = this.draw(code, size); this.cache.set(key, s) }
    return s
  }

  private draw(code: string, size: number): Stamp {
    const canvas = this.env.createCanvas(size, size)
    const ctx = canvas.getContext('2d')
    const c = size / 2
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size)
    ctx.beginPath(); ctx.arc(c, c, c - OUTLINE / 2 - 0.5, 0, Math.PI * 2)
    ctx.fillStyle = '#fff'; ctx.fill()
    ctx.strokeStyle = '#000'; ctx.lineWidth = OUTLINE; ctx.stroke()
    ctx.fillStyle = '#000'
    const spec = parseSymbol(code)
    switch (spec.kind) {
      case 'glyph': this.glyph(ctx, spec.glyph, c, c, size * 0.62); break
      case 'phyrexian': this.glyph(ctx, 'p', c, c, size * 0.62); break
      case 'hybrid': {
        ctx.beginPath(); ctx.moveTo(size - OUTLINE, OUTLINE); ctx.lineTo(OUTLINE, size - OUTLINE); ctx.stroke()
        this.glyph(ctx, spec.a, size * 0.34, size * 0.34, size * 0.4)
        this.glyph(ctx, spec.b, size * 0.66, size * 0.66, size * 0.4)
        break
      }
      case 'text': this.text(ctx, spec.text, c, c, size); break
    }
    return { size, canvas }
  }

  /** Draw a 32x32 glyph centred at (cx, cy) scaled so the viewbox spans `extent` dots. */
  private glyph(ctx: Ctx2D, name: string, cx: number, cy: number, extent: number) {
    const paths = MANA_PATHS[name]
    if (!paths) return
    const k = extent / MANA_VIEWBOX
    ctx.save(); ctx.translate(cx - extent / 2, cy - extent / 2); ctx.scale(k, k)
    for (const d of paths) ctx.fill(this.env.createPath(d))
    ctx.restore()
  }

  private text(ctx: Ctx2D, text: string, cx: number, cy: number, size: number) {
    let px = Math.round(size * 0.6)
    ctx.textBaseline = 'middle'
    for (; px >= 6; px--) {
      ctx.font = `bold ${px}px ${this.fontFamily}`
      if (ctx.measureText(text).width <= size * 0.7) break
    }
    const w = ctx.measureText(text).width
    ctx.fillText(text, cx - w / 2, cy)
    ctx.textBaseline = 'alphabetic'
  }
}
