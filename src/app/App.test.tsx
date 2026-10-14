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

function services(fetchCard: Services['client']['fetchCard']): Services {
  return {
    client: { fetchCard, fetchArtBlob: async () => { throw new Error('no art in tests') } },
    loadNames: async () => ['Lightning Bolt', 'Delver of Secrets'],
    env: nodeEnv,
    storage: { getItem: () => null, setItem: () => {} },
    decodeArt: async () => { throw new Error('unused') },
    printer: fakePrinter(),
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
