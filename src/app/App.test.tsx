// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { App } from './App'
import type { Services } from './services'
import { CardNotFound, NetworkError } from '../core/errors'
import { fakeServices } from '../../tests/fakeServices'
import { fakePrinter } from '../../tests/fakePrinter'

const bolt = JSON.parse(readFileSync('tests/fixtures/cards/bolt.json', 'utf8'))
const plane = JSON.parse(readFileSync('tests/fixtures/cards/plane.json', 'utf8'))

function services(fetchCard: Services['client']['fetchCard'], printer = fakePrinter()): Services {
  return fakeServices({ fetchCard, printer, storage: { getItem: () => null, setItem: () => {} } })
}
vi.mock('./browserEnv', async (orig) => ({ ...(await orig<object>()), ensureFonts: async () => {} }))

async function pick(name: string) {
  await userEvent.type(screen.getByRole('combobox'), `${name}{enter}`)
}

describe('App', () => {
  it('renders a proxy and shows the art alert when art fails', async () => {
    render(<App services={services(async () => bolt)} />)
    await pick('Lightning Bolt')
    await waitFor(() => expect(screen.getByTestId('preview')).toBeInTheDocument())
    expect(screen.getByText(/Art could not be loaded/)).toBeInTheDocument()
  })
  it('shows Front and Back previews for a two-faced card', async () => {
    render(<App services={fakeServices({ storage: { getItem: () => null, setItem: () => {} } })} />)
    await pick('Delver of Secrets')
    await waitFor(() => expect(screen.getAllByTestId('preview')).toHaveLength(2))
    expect(screen.getByText('Front')).toBeInTheDocument()
    expect(screen.getByText('Back')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Print' })).toHaveLength(1)
  })
  it('shows no captions for a one-sheet card', async () => {
    render(<App services={services(async () => bolt)} />)
    await pick('Lightning Bolt')
    await waitFor(() => expect(screen.getByTestId('preview')).toBeInTheDocument())
    expect(screen.queryByText('Front')).toBeNull()
    expect(screen.queryByText('Back')).toBeNull()
  })
  it('shows CardNotFound', async () => {
    render(<App services={services(async (n) => { throw new CardNotFound(n) })} />)
    await pick('Nope')
    await waitFor(() => expect(screen.getByText(/Scryfall has no card named "Nope"/)).toBeInTheDocument())
  })
  it('shows NetworkError', async () => {
    render(<App services={services(async () => { throw new NetworkError() })} />)
    await pick('Lightning Bolt')
    await waitFor(() => expect(screen.getByText(/Could not reach Scryfall/)).toBeInTheDocument())
  })
  it('shows UnsupportedLayout for a planar card', async () => {
    render(<App services={services(async () => plane)} />)
    await pick('Academy at Tolaria West')
    await waitFor(() => expect(screen.getByText(/'planar' layout/)).toBeInTheDocument())
  })
})

describe('App printing', () => {
  it('shows the chip, enables Print after connecting, and sends the card bytes', async () => {
    const printer = fakePrinter()
    render(<App services={services(async () => bolt, printer)} />)
    await pick('Lightning Bolt')
    await waitFor(() => expect(screen.getByTestId('preview')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled()
    await userEvent.click(screen.getByText('Connect printer'))
    await waitFor(() => expect(screen.getByText('PT210_FAKE')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Print' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Print' }))
    await waitFor(() => expect(printer.writes.reduce((a, w) => a + w.length, 0)).toBe(25808))
    expect(printer.writes[0].length).toBe(5)   // header frame; raster blocks follow in 100-byte chunks
    expect(printer.writes[1].length).toBe(100)
  })
  it('hides Print and shows "No Bluetooth" when unsupported', async () => {
    render(<App services={services(async () => bolt, fakePrinter('unsupported'))} />)
    await pick('Lightning Bolt')
    await waitFor(() => expect(screen.getByTestId('preview')).toBeInTheDocument())
    expect(screen.getByText('No Bluetooth')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Print' })).toBeNull()
  })
  it('shows a snackbar when connecting fails', async () => {
    const printer = fakePrinter(); printer.connectImpl = async () => { throw new Error('gatt') }
    render(<App services={services(async () => bolt, printer)} />)
    await userEvent.click(screen.getByText('Connect printer'))
    await waitFor(() => expect(screen.getByText(/Could not connect to the printer/)).toBeInTheDocument())
  })
  it('shows progress and Cancel while printing', async () => {
    const printer = fakePrinter('connected'); printer.name = 'PT210_FAKE'
    let release!: () => void
    const origWrite = printer.write.bind(printer)
    let gated = true
    printer.write = async (b) => { if (gated) { gated = false; await new Promise<void>((r) => { release = r }) } await origWrite(b) }
    render(<App services={services(async () => bolt, printer)} />)
    await pick('Lightning Bolt')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Print' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Print' }))
    await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Print progress' })).toBeInTheDocument())
    expect(screen.getByText('PT210_FAKE: printing')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    release()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument())
    expect(printer.writes.map((w) => w.length)).toEqual([5, 3])   // header, then feed after cancel
  })
})

describe('App shell', () => {
  it('has no app bar: the masthead image and the GitHub link live in the column', () => {
    render(<App services={services(async () => bolt)} />)
    expect(screen.queryByRole('banner')).toBeNull()
    expect(screen.getByRole('img', { name: 'Hot Proxies!' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /github/i })).toHaveAttribute('href', 'https://github.com/aurelio-amerio/hot-proxies')
  })
  it('shows the Wizards Fan Content Policy notice in the footer', () => {
    render(<App services={services(async () => bolt)} />)
    const notice = screen.getByText(/Not approved\/endorsed by Wizards/)
    expect(notice).toHaveTextContent('Hot Proxies is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.')
    expect(screen.getByRole('link', { name: 'Fan Content Policy' })).toHaveAttribute('href', 'https://company.wizards.com/en/legal/fancontentpolicy')
  })
})

describe('App modes', () => {
  it('starts in Card mode, switches to Deck and persists the choice', async () => {
    const store = new Map<string, string>()
    const s = services(async () => bolt)
    s.storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v) } }
    render(<App services={s} />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Card' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Deck' }))
    expect(screen.getByRole('button', { name: 'Deck' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Card' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('mode-switch').previousElementSibling).toContainElement(screen.getByRole('button', { name: 'Connect printer' }))
    expect(screen.getByRole('textbox', { name: 'Deck list' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(store.get('hot-proxies.mode.v1')).toBe('"deck"')
  })
  it('opens in Deck mode when that was stored', () => {
    const s = services(async () => bolt)
    s.storage = { getItem: (k) => (k === 'hot-proxies.mode.v1' ? '"deck"' : null), setItem: () => {} }
    render(<App services={s} />)
    expect(screen.getByRole('textbox', { name: 'Deck list' })).toBeInTheDocument()
  })
  it('keeps the deck text when switching modes back and forth', async () => {
    render(<App services={services(async () => bolt)} />)
    await userEvent.click(screen.getByRole('button', { name: 'Deck' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Deck list' }), '4 Lightning Bolt')
    await userEvent.click(screen.getByRole('button', { name: 'Card' }))
    await userEvent.click(screen.getByRole('button', { name: 'Deck' }))
    expect(screen.getByRole('textbox', { name: 'Deck list' })).toHaveValue('4 Lightning Bolt')
  })
  it('shows a deck print drop in the shared snackbar', async () => {
    const printer = fakePrinter('connected'); printer.name = 'PT210_FAKE'
    const origWrite = printer.write.bind(printer)
    let n = 0
    printer.write = async (b) => { if (++n === 2) { printer.set('disconnected'); throw new Error('gatt gone') } await origWrite(b) }
    render(<App services={services(async () => bolt, printer)} />)
    await userEvent.click(screen.getByRole('button', { name: 'Deck' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Deck list' }), '1 Lightning Bolt')
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Print 1 cards' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Print 1 cards' }))
    await waitFor(() => expect(screen.getByText('Printer disconnected during printing. Reconnect and print again.')).toBeInTheDocument())
  })
  it('switches to Tokens, persists it, and prints copies through the shared printer', async () => {
    const store = new Map<string, string>()
    const printer = fakePrinter('connected'); printer.name = 'PT210_FAKE'
    const s = services(async () => bolt, printer)
    s.storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v) } }
    render(<App services={s} />)
    await userEvent.click(screen.getByRole('button', { name: 'Tokens' }))
    expect(store.get('hot-proxies.mode.v1')).toBe('"tokens"')
    await userEvent.type(screen.getByRole('combobox', { name: 'Token name' }), 'Treasure{enter}')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Print' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'More copies' }))
    await userEvent.click(screen.getByRole('button', { name: 'Print' }))
    await waitFor(() => expect(printer.writes.reduce((a, w) => a + w.length, 0)).toBe(5 + 2 * (9 * 8 + 48 * 536 + 3)))
  })
  it('opens in Tokens mode when that was stored', () => {
    const s = services(async () => bolt)
    s.storage = { getItem: (k) => (k === 'hot-proxies.mode.v1' ? '"tokens"' : null), setItem: () => {} }
    render(<App services={s} />)
    expect(screen.getByRole('combobox', { name: 'Token name' })).toBeInTheDocument()
  })
  it('shows a token print drop in the shared snackbar', async () => {
    const printer = fakePrinter('connected'); printer.name = 'PT210_FAKE'; printer.failWrites = new Error('gatt')
    const s = services(async () => bolt, printer)
    s.storage = { getItem: (k) => (k === 'hot-proxies.mode.v1' ? '"tokens"' : null), setItem: () => {} }
    render(<App services={s} />)
    await userEvent.type(screen.getByRole('combobox', { name: 'Token name' }), 'Treasure{enter}')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Print' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Print' }))
    expect(await screen.findByText(/disconnected during printing/)).toBeInTheDocument()
  })
})

describe('App card art picker', () => {
  it('opens the printings from the art hotspot, stores the pick and reloads the art', async () => {
    const store = new Map<string, string>()
    const prints = [
      { ref: 'aaaaaaaa000040008000000000000001', artUrl: 'https://c/1.jpg', set: 'lea', released: '1993-08-05' },
      { ref: 'aaaaaaaa000040008000000000000002', artUrl: 'https://c/2.jpg', set: 'm10', released: '2009-07-17' },
    ]
    const fetchArtById = vi.fn(async () => { throw new Error('no art in tests') })
    const s = fakeServices({ fetchCard: async () => bolt, fetchPrints: async () => prints, fetchArtById, storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v) } } })
    render(<App services={s} />)
    await pick('Lightning Bolt')
    await waitFor(() => expect(screen.getByTestId('preview')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Edit name' })).toBeNull()      // Card mode: art only
    await userEvent.click(screen.getByRole('button', { name: 'Change art' }))
    const dialog = await screen.findByRole('dialog', { name: 'Choose art' })
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'M10 2009-07-17' })).toBeInTheDocument())
    expect(within(dialog).getByRole('button', { name: 'Default art' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(dialog).getByRole('button', { name: 'M10 2009-07-17' }))
    await waitFor(() => expect(JSON.parse(store.get('hot-proxies.art.v1')!)).toEqual({ 'Lightning Bolt': 'aaaaaaaa000040008000000000000002' }))
    expect(fetchArtById).toHaveBeenCalledWith('aaaaaaaa000040008000000000000002')
  })
  it('shows the printings error inside the dialog', async () => {
    const s = fakeServices({ fetchCard: async () => bolt, fetchPrints: async () => { throw new Error('boom') }, storage: { getItem: () => null, setItem: () => {} } })
    render(<App services={s} />)
    await pick('Lightning Bolt')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change art' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Change art' }))
    await waitFor(() => expect(screen.getByText('Could not load other printings.')).toBeInTheDocument())
  })
})
