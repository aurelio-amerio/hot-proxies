// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeckStrip } from './DeckStrip'
import type { DeckCard } from '../core/deck/run'
import type { DeckThumb } from './useDeck'

const card = (key: string, name: string, count: number): DeckCard => ({ key, name, count, line: 1, art: null, card: { name, manaCost: '', typeLine: '', oracleText: '' } })
const thumb = (overflow = false, artMissing = false): DeckThumb => ({ bits: { width: 8, height: 8, bits: new Uint8Array(64) }, overflow, artMissing })
const cards = [card('bolt', 'Lightning Bolt', 4), card('forest', 'Forest', 20)]
const thumbs = new Map([['bolt', thumb()], ['forest', thumb(true, true)]])

describe('DeckStrip', () => {
  it('shows one thumbnail per card with its count badge and a checkbox', () => {
    render(<DeckStrip cards={cards} thumbs={thumbs} excluded={new Set()} currentKey={null} disabled={false} onToggle={() => {}} onOpen={() => {}} />)
    expect(screen.getByRole('checkbox', { name: 'Include Lightning Bolt' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Include Forest' })).toBeChecked()
    expect(screen.getByText('×4')).toBeInTheDocument()
    expect(screen.getByText('×20')).toBeInTheDocument()
  })
  it('marks excluded cards unchecked and flags clipped text or missing art', () => {
    render(<DeckStrip cards={cards} thumbs={thumbs} excluded={new Set(['forest'])} currentKey={null} disabled={false} onToggle={() => {}} onOpen={() => {}} />)
    expect(screen.getByRole('checkbox', { name: 'Include Forest' })).not.toBeChecked()
    expect(screen.getByLabelText('Rules text clipped; art missing')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Lightning Bolt.*clipped/)).toBeNull()
  })
  it('toggles and opens', async () => {
    const onToggle = vi.fn(), onOpen = vi.fn()
    render(<DeckStrip cards={cards} thumbs={thumbs} excluded={new Set()} currentKey={null} disabled={false} onToggle={onToggle} onOpen={onOpen} />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include Forest' }))
    expect(onToggle).toHaveBeenCalledWith('forest')
    await userEvent.click(screen.getByRole('button', { name: 'Preview Lightning Bolt' }))
    expect(onOpen).toHaveBeenCalledWith('bolt')
  })
  it('disables the checkboxes while printing and highlights the current card', () => {
    render(<DeckStrip cards={cards} thumbs={thumbs} excluded={new Set()} currentKey="forest" disabled onToggle={() => {}} onOpen={() => {}} />)
    expect(screen.getByRole('checkbox', { name: 'Include Forest' })).toBeDisabled()
    expect(screen.getByTestId('deck-thumb-forest')).toHaveAttribute('data-current', 'true')
    expect(screen.getByTestId('deck-thumb-bolt')).toHaveAttribute('data-current', 'false')
  })
})
