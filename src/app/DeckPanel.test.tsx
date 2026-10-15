// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeckPanel, MOXFIELD_HINT } from './DeckPanel'
import { useDeck } from './useDeck'
import { DEFAULT_SETTINGS } from '../core/settings'
import type { Services } from './services'
import type { PrinterState } from '../core/printer/transport'
import { fakeServices } from '../../tests/fakeServices'
import { fakePrinter } from '../../tests/fakePrinter'

vi.mock('./browserEnv', async (orig) => ({ ...(await orig<object>()), ensureFonts: async () => {} }))

function Harness({ services, printerState }: { services: Services; printerState: PrinterState }) {
  const deck = useDeck(services, DEFAULT_SETTINGS)
  return <DeckPanel deck={deck} printerState={printerState} settings={DEFAULT_SETTINGS} />
}
const setup = (services = fakeServices(), printerState: PrinterState = 'connected') => render(<Harness services={services} printerState={printerState} />)
const textbox = () => screen.getByRole('textbox', { name: 'Deck list' })

describe('DeckPanel editing', () => {
  it('shows the live summary and enables Verify once there are entries', async () => {
    setup()
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled()
    await userEvent.type(textbox(), '4 Lightning Bolt{enter}2 lightning bolt{enter}1 Forest')
    expect(screen.getByText('7 cards, 2 distinct')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verify' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /^Print/ })).toBeNull()
  })
  it('counts parser problems in the summary', async () => {
    setup()
    await userEvent.type(textbox(), '0 Forest{enter}1 Lightning Bolt')
    expect(screen.getByText('1 card, 1 distinct')).toBeInTheDocument()
    expect(screen.getByText('1 line has problems')).toBeInTheDocument()
  })
  it('shows the Moxfield hint when a deck URL is pasted', async () => {
    setup()
    await userEvent.type(textbox(), 'https://moxfield.com/decks/b4VMi7ZsdUOcDNFXxctNsQ')
    expect(screen.getByText(MOXFIELD_HINT)).toBeInTheDocument()
  })
})

describe('DeckPanel verify', () => {
  it('opens the issues dialog on failure and Fix all rewrites the text', async () => {
    setup()
    await userEvent.type(textbox(), '4 Lightnin Bolt')
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: '1 card could not be resolved' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Fix all' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(textbox()).toHaveValue('4 Lightning Bolt')
  })
  it('moves to ready with the strip, the ready summary and the Print button', async () => {
    setup()
    await userEvent.type(textbox(), '4 Lightning Bolt{enter}1 Forest')
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }))
    await waitFor(() => expect(screen.getByText('5 cards ready, 2 distinct')).toBeInTheDocument())
    expect(screen.getByTestId('deck-strip')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Print 5 cards' })).toBeEnabled())
    expect(textbox()).not.toHaveAttribute('readonly')
  })
  it('shows Checking progress and a read-only text area while verifying', async () => {
    let release!: () => void
    const base = fakeServices()
    const services = fakeServices({ fetchCard: async (n) => { await new Promise<void>((r) => { release = r }); return base.client.fetchCard(n) } })
    setup(services)
    await userEvent.type(textbox(), '1 Lightning Bolt')
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }))
    await waitFor(() => expect(screen.getByText('Checking 0 of 1')).toBeInTheDocument())
    expect(textbox()).toHaveAttribute('readonly')
    release()
    await waitFor(() => expect(screen.getByText('1 card ready, 1 distinct')).toBeInTheDocument())
  })
  it('shows a network error alert', async () => {
    const services = fakeServices({ fetchCard: async () => { throw new (await import('../core/errors')).NetworkError() } })
    setup(services)
    await userEvent.type(textbox(), '1 Lightning Bolt')
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }))
    await waitFor(() => expect(screen.getByText(/Could not reach Scryfall/)).toBeInTheDocument())
  })
})

describe('DeckPanel selection and printing', () => {
  async function ready(services = fakeServices(), printerState: PrinterState = 'connected', text = '2 Lightning Bolt{enter}1 Forest') {
    setup(services, printerState)
    await userEvent.type(textbox(), text)
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }))
    await waitFor(() => expect(screen.getByTestId('deck-strip')).toBeInTheDocument())
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull())
  }
  it('updates the summary when cards are deselected and disables Print when none remain', async () => {
    await ready()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include Lightning Bolt' }))
    expect(screen.getByText('1 of 3 selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Print 1 cards' })).toBeEnabled()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include Forest' }))
    expect(screen.getByText('0 of 3 selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Print 0 cards' })).toBeDisabled()
  })
  it('disables Print when the printer is not connected', async () => {
    await ready(fakeServices({ printer: fakePrinter('disconnected') }), 'disconnected')
    expect(screen.getByRole('button', { name: 'Print 3 cards' })).toBeDisabled()
  })
  it('hides the print row when Bluetooth is unsupported', async () => {
    await ready(fakeServices({ printer: fakePrinter('unsupported') }), 'unsupported')
    expect(screen.queryByRole('button', { name: /^Print/ })).toBeNull()
  })
  it('prints, then shows the done line and Start over', async () => {
    const printer = fakePrinter('connected')
    await ready(fakeServices({ printer }))
    await userEvent.click(screen.getByRole('button', { name: 'Print 3 cards' }))
    await waitFor(() => expect(screen.getByText('3 cards printed')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Start over' }))
    expect(screen.getByRole('button', { name: 'Print 3 cards' })).toBeEnabled()
  })
  it('shows card progress with Cancel while printing, then Resume after cancelling', async () => {
    const printer = fakePrinter('connected')
    let release!: () => void; let gated = true
    const origWrite = printer.write.bind(printer)
    printer.write = async (b) => { if (gated) { gated = false; await new Promise<void>((r) => { release = r }) } await origWrite(b) }
    await ready(fakeServices({ printer }))
    await userEvent.click(screen.getByRole('button', { name: 'Print 3 cards' }))
    await waitFor(() => expect(screen.getByText('Card 1 of 3 · Lightning Bolt')).toBeInTheDocument())
    expect(screen.getByRole('progressbar', { name: 'Print progress' })).toBeInTheDocument()
    expect(textbox()).toHaveAttribute('readonly')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    release()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume from card 1' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Start over' })).toBeInTheDocument()
  })
  it('opens a full-size preview when a thumbnail is tapped', async () => {
    await ready()
    await userEvent.click(screen.getByRole('button', { name: 'Preview Forest' }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Forest' })).toBeInTheDocument())
    expect(screen.getByTestId('preview')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Print' })).toBeNull()
  })
})
