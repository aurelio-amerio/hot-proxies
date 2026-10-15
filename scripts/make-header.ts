// Downscale the masthead artwork to a web-sized JPEG. Usage: npm run make:header [-- source.jpg]
import { readFileSync, writeFileSync } from 'node:fs'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const [src = 'brainstorm/header-source.png', dst = 'src/assets/header.jpg'] = process.argv.slice(2)
const WIDTH = 1600, QUALITY = 80

const img = await loadImage(readFileSync(src))
const height = Math.round((img.height * WIDTH) / img.width)
const canvas = createCanvas(WIDTH, height)
const ctx = canvas.getContext('2d')
ctx.imageSmoothingEnabled = true
ctx.imageSmoothingQuality = 'high'
ctx.drawImage(img, 0, 0, WIDTH, height)
const out = canvas.toBuffer('image/jpeg', QUALITY)
writeFileSync(dst, out)
console.log(`${dst}: ${WIDTH}x${height}, ${(out.length / 1024).toFixed(0)} KB`)
