// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TokensPanel } from './TokensPanel'
import { useTokens, TOKEN_DRAFT_KEY } from './useTokens'
import { DEFAULT_SETTINGS } from '../core/settings'
import { fakeServices, memoryStorage } from '../../tests/fakeServices'
import type { Services } from './services'

vi.mock('./browserEnv', async (orig) => ({ ...(await orig<object>()), ensureFonts: async () => {} }))

/** Mounts the real hook and the panel together so the panel is driven like in App. */
function Harness({ services }: { services: Services }) {
  const tokens = useTokens(services, DEFAULT_SETTINGS)
  return <TokensPanel tokens={tokens} printerState={services.printer.state} settings={DEFAULT_SETTINGS} />
}
const pickToken = async (name: string) => { await userEvent.type(screen.getByRole('combobox', { name: 'Token name' }), `${name}{enter}`) }

describe('TokensPanel', () => {
  it('starts with a hint, picks a token, shows the hotspots and the copies row', async () => {
    const s = fakeServices()
    render(<Harness services={s} />)
    expect(screen.getByText(/Type a token name/)).toBeInTheDocument()
    await pickToken('Treasure')
    await waitFor(() => expect(screen.getByTestId('preview')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Edit name' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit power and toughness' })).toBeInTheDocument()
    expect(screen.getByText('Tap a part of the card to edit it.')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Copies' })).toHaveValue(1)
    expect(screen.queryByRole('group', { name: 'Variants' })).toBeNull()
  })
  it('shows variant chips for Goblin and switches the draft', async () => {
    const storage = memoryStorage()
    render(<Harness services={fakeServices({ storage })} />)
    await pickToken('Goblin')
    const group = await screen.findByRole('group', { name: 'Variants' })
    const chips = within(group).getAllByRole('button')
    expect(chips.map((c) => c.textContent)).toEqual(['1/1 · Haste', '1/1'])
    expect(chips[0]).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(chips[1])
    await waitFor(() => expect(JSON.parse(storage.map.get(TOKEN_DRAFT_KEY)!).base.variant).toBe(1))
    expect(JSON.parse(storage.map.get(TOKEN_DRAFT_KEY)!).card.oracleText).toBe('')
  })
  it('opens the stat dialog from its hotspot and saves the edit into the draft', async () => {
    const storage = memoryStorage()
    render(<Harness services={fakeServices({ storage })} />)
    await pickToken('Goblin')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit power and toughness' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Edit power and toughness' }))
    const power = await screen.findByRole('textbox', { name: 'Power' })
    await userEvent.clear(power); await userEvent.type(power, '3')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(JSON.parse(storage.map.get(TOKEN_DRAFT_KEY)!).card.stat).toEqual({ kind: 'pt', power: '3', toughness: '1' }))
    expect(screen.queryByText('Tap a part of the card to edit it.')).toBeNull()
  })
  it('opens the art picker with the variant printings first and stores the pick', async () => {
    const storage = memoryStorage()
    render(<Harness services={fakeServices({ storage })} />)
    await pickToken('Goblin')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change art' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Change art' }))
    const dialog = await screen.findByRole('dialog', { name: 'Choose art' })
    const tiles = within(dialog).getAllByRole('button')
    expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual(['No art', 'Art 1', 'Art 2', 'Art 3', 'Art 4'])
    expect(within(dialog).getByText('This variant')).toBeInTheDocument()
    expect(within(dialog).getByText('Other printings of this name')).toBeInTheDocument()
    expect(within(dialog).getByRole('img', { name: 'Art 3' })).toHaveAttribute('src', 'https://cards.scryfall.io/art_crop/front/a/a/aaaaaaaa-0000-4000-8000-000000000004.jpg')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Art 3' }))
    await waitFor(() => expect(JSON.parse(storage.map.get(TOKEN_DRAFT_KEY)!).artRef).toBe('aaaaaaaa000040008000000000000004'))
  })
  it('copies stepper clamps and Blank token starts a draft', async () => {
    const storage = memoryStorage()
    render(<Harness services={fakeServices({ storage })} />)
    await userEvent.click(screen.getByRole('button', { name: 'Blank token' }))
    await waitFor(() => expect(screen.getByTestId('preview')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Fewer copies' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'More copies' }))
    expect(screen.getByRole('spinbutton', { name: 'Copies' })).toHaveValue(2)
    const field = screen.getByRole('spinbutton', { name: 'Copies' })
    await userEvent.clear(field); await userEvent.type(field, '500'); await userEvent.tab()
    await waitFor(() => expect(JSON.parse(storage.map.get(TOKEN_DRAFT_KEY)!).copies).toBe(99))
    expect(field).toHaveValue(99)
    await userEvent.clear(field); await userEvent.type(field, '{enter}')
    await waitFor(() => expect(JSON.parse(storage.map.get(TOKEN_DRAFT_KEY)!).copies).toBe(1))
    expect(field).toHaveValue(1)
    await userEvent.clear(field); await userEvent.type(field, '500{enter}')
    await waitFor(() => expect(JSON.parse(storage.map.get(TOKEN_DRAFT_KEY)!).copies).toBe(99))
    expect(screen.getByRole('button', { name: 'More copies' })).toBeDisabled()
  })
  it('survives a restored draft whose variant index no longer exists', async () => {
    const storage = memoryStorage()
    storage.map.set(TOKEN_DRAFT_KEY, JSON.stringify({ base: { name: 'Goblin', variant: 7 }, card: { name: 'Goblin', manaCost: '', typeLine: 'Token Creature — Goblin', oracleText: '' }, artRef: null, copies: 1 }))
    render(<Harness services={fakeServices({ storage })} />)
    await waitFor(() => expect(screen.getByTestId('preview')).toBeInTheDocument())
    const group = await screen.findByRole('group', { name: 'Variants' })
    expect(within(group).getAllByRole('button').every((c) => c.getAttribute('aria-pressed') === 'false')).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Change art' }))
    const dialog = await screen.findByRole('dialog', { name: 'Choose art' })
    expect(within(dialog).getAllByRole('button').length).toBe(5)   // none + 4 Goblin printings, first variant treated as current
  })
  it('shows the token list error and keeps Blank token usable', async () => {
    render(<Harness services={fakeServices({ loadTokens: async () => { throw new Error('404') } })} />)
    await waitFor(() => expect(screen.getByText('Token list unavailable.')).toBeInTheDocument())
    expect(screen.getByRole('combobox', { name: 'Token name' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Blank token' }))
    await waitFor(() => expect(screen.getByTestId('preview')).toBeInTheDocument())
  })
})
