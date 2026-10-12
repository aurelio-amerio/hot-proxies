// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSettings, SETTINGS_KEY } from './useSettings'
import { DEFAULT_SETTINGS } from '../core/settings'

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, map: m } }

describe('useSettings', () => {
  it('starts from defaults when storage is empty', () => {
    const { result } = renderHook(() => useSettings(mem()))
    expect(result.current[0]).toEqual(DEFAULT_SETTINGS)
  })
  it('loads, normalizes and persists', () => {
    const s = mem(); s.setItem(SETTINGS_KEY, JSON.stringify({ dither: 'bayer4', gamma: 99 }))
    const { result } = renderHook(() => useSettings(s))
    expect(result.current[0].dither).toBe('bayer4'); expect(result.current[0].gamma).toBe(1.6)
    act(() => result.current[1]({ textSize: 20 }))
    expect(result.current[0].textSize).toBe(20)
    expect(JSON.parse(s.map.get(SETTINGS_KEY)!).textSize).toBe(20)
    act(() => result.current[2]())
    expect(result.current[0]).toEqual(DEFAULT_SETTINGS)
  })
  it('survives invalid JSON in storage', () => {
    const s = mem(); s.setItem(SETTINGS_KEY, '{not json')
    const { result } = renderHook(() => useSettings(s))
    expect(result.current[0]).toEqual(DEFAULT_SETTINGS)
  })
})
