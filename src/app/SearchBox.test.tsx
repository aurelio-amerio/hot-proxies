// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchBox } from './SearchBox'

describe('SearchBox', () => {
  it('suggests names from the index and reports the picked exact name', async () => {
    const onPick = vi.fn()
    const loadNames = vi.fn(async () => ['Lightning Bolt', 'Lightning Helix', 'Forest'])
    render(<SearchBox loadNames={loadNames} onPick={onPick} />)
    const input = screen.getByRole('combobox')
    await userEvent.type(input, 'light')
    await waitFor(() => expect(screen.getByText('Lightning Bolt')).toBeInTheDocument())
    expect(screen.queryByText('Forest')).not.toBeInTheDocument()
    await userEvent.click(screen.getByText('Lightning Bolt'))
    expect(onPick).toHaveBeenCalledWith('Lightning Bolt')
  })
  it('submits the typed text on Enter when it is not in the list', async () => {
    const onPick = vi.fn()
    render(<SearchBox loadNames={async () => ['Forest']} onPick={onPick} />)
    await userEvent.type(screen.getByRole('combobox'), 'Nonexistent Card{enter}')
    expect(onPick).toHaveBeenCalledWith('Nonexistent Card')
  })
})
