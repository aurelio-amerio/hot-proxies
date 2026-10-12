import type { RenderEnv, CanvasLike } from '../core/env'
import { imageDataToGrey } from '../core/art/grey'
import type { GreyImage } from '../core/art/types'

export const browserEnv: RenderEnv = {
  createCanvas(w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h
    return c as unknown as CanvasLike
  },
  createPath: (d) => new Path2D(d),
}

/** Make sure both weights are loaded before measuring text, or the first render uses a fallback font. */
export async function ensureFonts(family: string): Promise<void> {
  await Promise.all([document.fonts.load(`17px ${family}`), document.fonts.load(`bold 22px ${family}`)])
}

export async function blobToGrey(blob: Blob): Promise<GreyImage> {
  const bmp = await createImageBitmap(blob)
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height
  const ctx = c.getContext('2d')!
  ctx.drawImage(bmp, 0, 0)
  bmp.close()
  return imageDataToGrey(ctx.getImageData(0, 0, c.width, c.height))
}
