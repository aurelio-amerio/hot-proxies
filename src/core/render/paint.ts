import type { CardData } from '../card/types'
import type { Settings } from '../settings'
import type { RenderEnv, Ctx2D } from '../env'
import type { Geometry, Rect } from '../layout/fit'
import type { BitImage } from '../art/types'
import { StampCache } from '../symbols/stamp'
import { drawLines } from '../text/draw'
import { canvasToBitImage } from '../output/packed'
import { FRAME, TEXT_PAD, STAT_PAD } from '../layout/constants'

const strokeRect = (ctx: Ctx2D, r: Rect, lw: number) => {
  ctx.lineWidth = lw; ctx.strokeStyle = '#000'
  ctx.beginPath(); ctx.moveTo(r.x + lw / 2, r.y + lw / 2); ctx.lineTo(r.x + r.w - lw / 2, r.y + lw / 2)
  ctx.lineTo(r.x + r.w - lw / 2, r.y + r.h - lw / 2); ctx.lineTo(r.x + lw / 2, r.y + r.h - lw / 2); ctx.closePath(); ctx.stroke()
}

/** Paint the card (text, bars, symbols) in greyscale, threshold it, then blit the dithered art bits. */
export function paint(card: CardData, g: Geometry, artBits: BitImage | null, s: Settings, env: RenderEnv, stamps: StampCache): BitImage {
  const canvas = env.createCanvas(g.card.w, g.card.h)
  const ctx = canvas.getContext('2d')
  const family = s.fontFamily
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, g.card.w, g.card.h)
  strokeRect(ctx, { x: 0, y: 0, w: g.card.w, h: g.card.h }, FRAME)

  // name bar
  strokeRect(ctx, g.nameBar, 2)
  ctx.fillStyle = '#000'; ctx.font = `bold ${g.nameFontSize}px ${family}`; ctx.textBaseline = 'alphabetic'
  ctx.fillText(card.name, g.nameBar.x + 8, g.nameBar.y + Math.round(34 * 0.68))
  const codes = (card.manaCost.match(/\{([^}]+)\}/g) ?? []).map((m) => m.slice(1, -1))
  if (codes.length) {
    const step = g.costSymbolSize + 3
    const y = g.costOnSecondLine ? g.nameBar.y + 34 : g.nameBar.y + Math.round((34 - g.costSymbolSize) / 2)
    let x = g.nameBar.x + g.nameBar.w - 8 - codes.length * step + 3
    for (const code of codes) { ctx.drawImage(stamps.get(code, g.costSymbolSize).canvas, x, y); x += step }
  }

  // art frame (art itself is blitted after thresholding)
  strokeRect(ctx, g.art, 2)

  // type bar
  strokeRect(ctx, g.typeBar, 2)
  ctx.fillStyle = '#000'; ctx.font = `bold 18px ${family}`
  ctx.fillText(card.typeLine, g.typeBar.x + 8, g.typeBar.y + Math.round(g.typeBar.h * 0.7))

  // text box
  strokeRect(ctx, g.textBox, 2)
  drawLines(ctx, g.textLines, g.textBox.x + TEXT_PAD, g.textBox.y + TEXT_PAD, g.lineHeight, `${g.textFontSize}px ${family}`, stamps, g.symbolSize)

  // stat box
  if (g.statBox && card.stat) {
    ctx.fillStyle = '#fff'; ctx.fillRect(g.statBox.x, g.statBox.y, g.statBox.w, g.statBox.h)
    strokeRect(ctx, g.statBox, 2)
    const label = card.stat.kind === 'pt' ? `${card.stat.power}/${card.stat.toughness}` : card.stat.value
    ctx.fillStyle = '#000'; ctx.font = `bold 24px ${family}`
    ctx.fillText(label, g.statBox.x + STAT_PAD, g.statBox.y + Math.round(g.statBox.h * 0.75))
  }

  const bits = canvasToBitImage(canvas)
  if (artBits) {
    const ax = g.art.x + 2, ay = g.art.y + 2
    for (let y = 0; y < artBits.height; y++) bits.bits.set(artBits.bits.subarray(y * artBits.width, (y + 1) * artBits.width), (ay + y) * bits.width + ax)
  }
  return bits
}

export const artInnerBox = (g: Geometry) => ({ w: g.art.w - 4, h: g.art.h - 4 })
