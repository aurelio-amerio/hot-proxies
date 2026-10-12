// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { useProxy } from './useProxy'
import type { Services } from './services'
import { DEFAULT_SETTINGS } from '../core/settings'
import { nodeEnv } from '../../tests/nodeEnv'

vi.mock('./browserEnv', async (orig) => ({
  ...(await orig<object>()),
  ensureFonts: async () => { throw new Error('font 404') },   // e.g. MPlantin chosen without the local file
}))

const bolt = JSON.parse(readFileSync('tests/fixtures/cards/bolt.json', 'utf8'))
const services: Services = {
  client: { fetchCard: async () => bolt, fetchArtBlob: async () => { throw new Error('no art') } },
  loadNames: async () => [],
  env: nodeEnv,
  storage: { getItem: () => null, setItem: () => {} },
  decodeArt: async () => { throw new Error('unused') },
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
