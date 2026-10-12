import { createCanvas, GlobalFonts, Path2D } from '@napi-rs/canvas'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { RenderEnv, CanvasLike } from '../src/core/env'

export const FONT_FAMILY = 'ProxySerif'

const fontsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'fonts')
GlobalFonts.registerFromPath(path.join(fontsDir, 'CrimsonText-Regular.ttf'), FONT_FAMILY)
GlobalFonts.registerFromPath(path.join(fontsDir, 'CrimsonText-Bold.ttf'), FONT_FAMILY)

export const nodeEnv: RenderEnv = {
  createCanvas: (w, h) => createCanvas(w, h) as unknown as CanvasLike,
  createPath: (d) => new Path2D(d),
}

/** Save a canvas produced by nodeEnv as PNG (used by golden tests). */
export function canvasToPng(canvas: CanvasLike): Buffer {
  return (canvas as unknown as { toBuffer(mime: 'image/png'): Buffer }).toBuffer('image/png')
}
