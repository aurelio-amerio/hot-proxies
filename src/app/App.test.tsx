// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { App } from './App'
import type { Services } from './services'
import { CardNotFound, NetworkError } from '../core/errors'
import { fakeServices } from '../../tests/fakeServices'
import { fakePrinter } from '../../tests/fakePrinter'

const bolt = JSON.parse(readFileSync('tests/fixtures/cards/bolt.json', 'utf8'))
const delver = JSON.parse(readFileSync('tests/fixtures/cards/delver.json', 'utf8'))

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
  it('shows UnsupportedLayout for a transform card', async () => {
    render(<App services={services(async () => delver)} />)
    await pick('Delver of Secrets')
    await waitFor(() => expect(screen.getByText(/'transform' layout/)).toBeInTheDocument())
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
})
