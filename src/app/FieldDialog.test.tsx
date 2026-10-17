// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FieldDialog } from './FieldDialog'
import type { CardData } from '../core/card/types'

const goblin: CardData = { name: 'Goblin', manaCost: '', typeLine: 'Token Creature — Goblin', oracleText: 'Haste', stat: { kind: 'pt', power: '1', toughness: '1' } }

describe('FieldDialog', () => {
  it('edits the name, disables Save when empty, and saves the trimmed patch on Enter', async () => {
    const onSave = vi.fn(), onClose = vi.fn()
    render(<FieldDialog field="name" card={goblin} onSave={onSave} onClose={onClose} />)
    const input = screen.getByRole('textbox', { name: 'Name' })
    expect(input).toHaveValue('Goblin')
    await userEvent.clear(input)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.type(input, ' Goblin Chief{enter}')
    expect(onSave).toHaveBeenCalledWith({ name: ' Goblin Chief' })
  })
  it('edits the type line and the rules text', async () => {
    const onSave = vi.fn()
    const { rerender } = render(<FieldDialog field="type" card={goblin} onSave={onSave} onClose={() => {}} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Type line' }), ' Warrior')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenLastCalledWith({ typeLine: 'Token Creature — Goblin Warrior' })
    rerender(<FieldDialog field="rules" card={goblin} onSave={onSave} onClose={() => {}} />)
    const rules = screen.getByRole('textbox', { name: 'Rules text' })
    expect(rules).toHaveValue('Haste')
    await userEvent.type(rules, '{enter}Menace')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenLastCalledWith({ oracleText: 'Haste\nMenace' })
    expect(screen.getByText(/drawn as icons/)).toBeInTheDocument()
  })
  it('switches the stat between P/T, loyalty and none', async () => {
    const onSave = vi.fn()
    render(<FieldDialog field="stat" card={goblin} onSave={onSave} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'P/T', pressed: true })).toBeInTheDocument()
    await userEvent.clear(screen.getByRole('textbox', { name: 'Power' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Power' }), '2')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenLastCalledWith({ stat: { kind: 'pt', power: '2', toughness: '1' } })
    await userEvent.click(screen.getByRole('button', { name: 'Loyalty' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Loyalty' }), '4')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenLastCalledWith({ stat: { kind: 'loyalty', value: '4' } })
    await userEvent.click(screen.getByRole('button', { name: 'None' }))
    expect(screen.queryByRole('textbox', { name: 'Loyalty' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenLastCalledWith({ stat: { kind: 'none' } })
  })
  it('starts from None for a card without a stat, and Cancel closes without saving', async () => {
    const onSave = vi.fn(), onClose = vi.fn()
    render(<FieldDialog field="stat" card={{ ...goblin, stat: undefined }} onSave={onSave} onClose={onClose} />)
    expect(screen.getByRole('button', { name: 'None', pressed: true })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled(); expect(onSave).not.toHaveBeenCalled()
  })
  it('renders nothing when field is null', () => {
    render(<FieldDialog field={null} card={goblin} onSave={() => {}} onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
