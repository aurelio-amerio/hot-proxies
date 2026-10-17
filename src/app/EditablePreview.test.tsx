// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { EditablePreview } from './EditablePreview'
import { fit } from '../core/layout/fit'
import { normalizeScryfall } from '../core/card/normalize'
import { DEFAULT_SETTINGS } from '../core/settings'
import { nodeEnv } from '../../tests/nodeEnv'
import type { BitImage } from '../core/art/types'

const card = normalizeScryfall(JSON.parse(readFileSync('tests/fixtures/cards/bolt.json', 'utf8'))).sheets[0]
const geometry = fit(card, DEFAULT_SETTINGS, nodeEnv)
const bits: BitImage = { width: geometry.card.w, height: geometry.card.h, bits: new Uint8Array(geometry.card.w * geometry.card.h) }
const ALL = ['name', 'art', 'type', 'rules', 'stat'] as const

describe('EditablePreview', () => {
  it('renders one button per enabled hotspot, positioned in percent of the card, stat after rules', async () => {
    const onEdit = vi.fn()
    render(<EditablePreview bits={bits} geometry={geometry} dotsPerLine={384} dpi={203} enabled={[...ALL]} onEdit={onEdit} />)
    const buttons = screen.getAllByRole('button').filter((b) => b.closest('[data-testid="hotspots"]'))
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Edit name', 'Change art', 'Edit type line', 'Edit rules text', 'Edit power and toughness'])
    const name = screen.getByRole('button', { name: 'Edit name' })
    expect(parseFloat(name.style.left)).toBeCloseTo((100 * geometry.nameBar.x) / geometry.card.w, 3)
    expect(parseFloat(name.style.width)).toBeCloseTo((100 * geometry.nameBar.w) / geometry.card.w, 3)
    await userEvent.click(screen.getByRole('button', { name: 'Change art' }))
    expect(onEdit).toHaveBeenCalledWith('art')
  })
  it('renders only the enabled hotspots and none when disabled is set', () => {
    const { rerender } = render(<EditablePreview bits={bits} geometry={geometry} dotsPerLine={384} dpi={203} enabled={['art']} onEdit={() => {}} />)
    expect(screen.getByRole('button', { name: 'Change art' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit name' })).toBeNull()
    rerender(<EditablePreview bits={bits} geometry={geometry} dotsPerLine={384} dpi={203} enabled={['art']} disabled onEdit={() => {}} />)
    expect(screen.getByRole('button', { name: 'Change art' })).toBeDisabled()
  })
  it('still shows the zoom controls from Preview', () => {
    render(<EditablePreview bits={bits} geometry={geometry} dotsPerLine={384} dpi={203} enabled={[]} onEdit={() => {}} />)
    expect(screen.getByRole('button', { name: '2×' })).toBeInTheDocument()
    expect(screen.getByTestId('preview')).toBeInTheDocument()
  })
})
