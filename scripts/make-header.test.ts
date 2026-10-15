import { describe, it, expect } from 'vitest'
import { readFileSync, statSync } from 'node:fs'
import { loadImage } from '@napi-rs/canvas'

const ASSET = 'src/assets/header.jpg'

describe('header asset', () => {
  it('is a web-sized JPEG: at most 1600 px wide and under 1 MB', async () => {
    expect(statSync(ASSET).size).toBeLessThan(1024 * 1024)
    const img = await loadImage(readFileSync(ASSET))
    expect(img.width).toBeLessThanOrEqual(1600)
  })
})
