import { loadImage } from '@napi-rs/canvas'
import { nodeEnv } from './nodeEnv'
import { imageDataToGrey } from '../src/core/art/grey'
import type { GreyImage } from '../src/core/art/types'

export async function loadArt(path: string): Promise<GreyImage> {
  const img = await loadImage(path)
  const canvas = nodeEnv.createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  return imageDataToGrey(ctx.getImageData(0, 0, img.width, img.height))
}
