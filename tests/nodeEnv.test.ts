import { describe, it, expect } from 'vitest'
import { nodeEnv, FONT_FAMILY } from './nodeEnv'

describe('nodeEnv', () => {
  it('measures text with the bundled font, bold wider than regular', () => {
    const ctx = nodeEnv.createCanvas(100, 50).getContext('2d')
    ctx.font = `17px ${FONT_FAMILY}`
    const regular = ctx.measureText('Whenever a creature').width
    ctx.font = `bold 17px ${FONT_FAMILY}`
    const bold = ctx.measureText('Whenever a creature').width
    expect(regular).toBeGreaterThan(50)
    expect(bold).toBeGreaterThan(regular)
  })

  it('fills an SVG path through createPath', () => {
    const canvas = nodeEnv.createCanvas(10, 10)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 10, 10)
    ctx.fillStyle = '#000'; ctx.fill(nodeEnv.createPath('M0 0 H10 V10 H0 Z'))
    expect(ctx.getImageData(5, 5, 1, 1).data[0]).toBe(0)
  })
})
