/** Generate simple PWA icons: black rounded square with a white "HP". Run: npm run make:icons */
import { createCanvas } from '@napi-rs/canvas'
import { mkdirSync, writeFileSync } from 'node:fs'

mkdirSync('public/icons', { recursive: true })
for (const size of [192, 512]) {
  const c = createCanvas(size, size), ctx = c.getContext('2d')
  const r = size * 0.2
  ctx.fillStyle = '#212121'
  ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(size - r, 0); ctx.arcTo(size, 0, size, r, r); ctx.lineTo(size, size - r)
  ctx.arcTo(size, size, size - r, size, r); ctx.lineTo(r, size); ctx.arcTo(0, size, 0, size - r, r); ctx.lineTo(0, r); ctx.arcTo(0, 0, r, 0, r); ctx.fill()
  ctx.fillStyle = '#fff'; ctx.font = `bold ${size * 0.42}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText('HP', size / 2, size / 2 + size * 0.02)
  writeFileSync(`public/icons/icon-${size}.png`, c.toBuffer('image/png'))
}
console.log('icons written')
