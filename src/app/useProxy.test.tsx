// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { useProxy } from './useProxy'
import type { Services } from './services'
import { DEFAULT_SETTINGS } from '../core/settings'
import { nodeEnv } from '../../tests/nodeEnv'
import { fakePrinter } from '../../tests/fakePrinter'

vi.mock('./browserEnv', async (orig) => ({
  ...(await orig<object>()),
  ensureFonts: async () => { throw new Error('font 404') },   // e.g. MPlantin chosen without the local file
}))

const bolt = JSON.parse(readFileSync('tests/fixtures/cards/bolt.json', 'utf8'))
const services: Services = {
  client: { fetchCard: async () => bolt, fetchCardById: async () => { throw new Error('unused') }, fetchArtBlob: async () => { throw new Error('no art') }, fetchPrints: async () => [], fetchArtById: async () => { throw new Error('unused') } },
  loadNames: async () => [],
  loadTokens: async () => ({ version: 1, tokens: [] }),
  env: nodeEnv,
  storage: { getItem: () => null, setItem: () => {} },
  decodeArt: async () => { throw new Error('unused') },
  printer: fakePrinter(),
}

describe('useProxy', () => {
  it('still renders with a fallback font and warns when the font fails to load', async () => {
    const settings = { ...DEFAULT_SETTINGS, fontFamily: 'MPlantin' as const }
    const { result } = renderHook(() => useProxy(services, settings))
    await act(() => result.current.render('Lightning Bolt'))
    await waitFor(() => expect(result.current.bits).not.toBeNull())
    expect(result.current.errors.some((e) => /MPlantin/.test(e.message))).toBe(true)
  })
})
