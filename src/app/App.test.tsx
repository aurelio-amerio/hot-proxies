// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { App } from './App'
import type { Services } from './services'
import { CardNotFound, NetworkError } from '../core/errors'
import { nodeEnv } from '../../tests/nodeEnv'
import { fakePrinter } from '../../tests/fakePrinter'

const bolt = JSON.parse(readFileSync('tests/fixtures/cards/bolt.json', 'utf8'))
const delver = JSON.parse(readFileSync('tests/fixtures/cards/delver.json', 'utf8'))

function services(fetchCard: Services['client']['fetchCard'], printer = fakePrinter()): Services {
  return {
    client: { fetchCard, fetchArtBlob: async () => { throw new Error('no art in tests') } },
    loadNames: async () => ['Lightning Bolt', 'Delver of Secrets'],
    env: nodeEnv,
    storage: { getItem: () => null, setItem: () => {} },
    decodeArt: async () => { throw new Error('unused') },
    printer,
  }
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
    expect(printer.writes[0].length).toBe(100)
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
    printer.write = async (b) => { await new Promise<void>((r) => { release = r }); await origWrite(b) }
    render(<App services={services(async () => bolt, printer)} />)
    await pick('Lightning Bolt')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Print' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Print' }))
    await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Print progress' })).toBeInTheDocument())
    expect(screen.getByText('PT210_FAKE: printing')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    release()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument())
    expect(printer.writes.length).toBe(1)
  })
})
