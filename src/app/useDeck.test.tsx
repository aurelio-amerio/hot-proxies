// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useDeck, DECK_TEXT_KEY } from './useDeck'
import { DEFAULT_SETTINGS } from '../core/settings'
import { NetworkError } from '../core/errors'
import { fakeServices, memoryStorage } from '../../tests/fakeServices'

vi.mock('./browserEnv', async (orig) => ({ ...(await orig<object>()), ensureFonts: async () => {} }))

function hook(services = fakeServices()) {
  return renderHook(() => useDeck(services, DEFAULT_SETTINGS))
}

describe('useDeck text', () => {
  it('starts from the stored text and persists edits', () => {
    const storage = memoryStorage(); storage.map.set(DECK_TEXT_KEY, '2 Forest')
    const { result } = hook(fakeServices({ storage }))
    expect(result.current.text).toBe('2 Forest')
    expect(result.current.distinct).toEqual([{ key: 'forest', name: 'Forest', count: 2, line: 1 }])
    act(() => result.current.setText('4 Lightning Bolt'))
    expect(storage.map.get(DECK_TEXT_KEY)).toBe('4 Lightning Bolt')
    expect(result.current.state).toBe('editing')
  })
})

describe('useDeck verify', () => {
  it('resolves every distinct card and builds the run', async () => {
    const { result } = hook()
    act(() => result.current.setText('4 Lightning Bolt\n2 lightning bolt\n1 Tarmogoyf'))
    await act(() => result.current.verify())
    await waitFor(() => expect(result.current.state).toBe('ready'))
    expect(result.current.run!.cards.map((c) => [c.name, c.count])).toEqual([['Lightning Bolt', 6], ['Tarmogoyf', 1]])
    expect(result.current.run!.items.length).toBe(7)
    expect(result.current.issues).toBeNull()
    expect(result.current.verifyProgress).toBeNull()
  })
  it('lists not-found names with a suggestion, unsupported layouts and bad counts, pinned to lines, and stays editing', async () => {
    const { result } = hook()
    act(() => result.current.setText('4 Lightnin Bolt (STA) 42\n0 Forest\n1 Delver of Secrets\n1 Zzzzqqq'))
    await act(() => result.current.verify())
    expect(result.current.state).toBe('editing')
    expect(result.current.run).toBeNull()
    expect(result.current.issues).toEqual([
      { kind: 'not-found', line: 1, text: '4 Lightnin Bolt (STA) 42', name: 'Lightnin Bolt', suggestion: 'Lightning Bolt' },
      { kind: 'bad-count', line: 2, text: '0 Forest' },
      { kind: 'unsupported-layout', line: 3, text: '1 Delver of Secrets', name: 'Delver of Secrets', layout: 'transform' },
      { kind: 'not-found', line: 4, text: '1 Zzzzqqq', name: 'Zzzzqqq', suggestion: null },
    ])
  })
  it('still lists unresolved names when names.json fails to load', async () => {
    const { result } = hook(fakeServices({ loadNames: async () => { throw new Error('names.json: HTTP 404') } }))
    act(() => result.current.setText('1 Lightnin Bolt'))
    await act(() => result.current.verify())
    expect(result.current.issues).toEqual([{ kind: 'not-found', line: 1, text: '1 Lightnin Bolt', name: 'Lightnin Bolt', suggestion: null }])
  })
  it('stops on a network error with one message and no issues', async () => {
    let calls = 0
    const services = fakeServices({ fetchCard: async () => { calls++; throw new NetworkError() } })
    const { result } = hook(services)
    act(() => result.current.setText('1 Lightning Bolt\n1 Tarmogoyf'))
    await act(() => result.current.verify())
    expect(calls).toBe(1)
    expect(result.current.state).toBe('editing')
    expect(result.current.issues).toBeNull()
    expect(result.current.error).toMatch(/Could not reach Scryfall/)
    act(() => result.current.clearError())
    expect(result.current.error).toBeNull()
  })
  it('ignores text edits while verifying (the field is read-only then) and finishes the verify', async () => {
    let release!: () => void
    const base = fakeServices()
    const services = fakeServices({ fetchCard: async (n) => { await new Promise<void>((r) => { release = r }); return base.client.fetchCard(n) } })
    const { result } = hook(services)
    act(() => result.current.setText('1 Lightning Bolt'))
    let p!: Promise<void>; act(() => { p = result.current.verify() })
    await waitFor(() => expect(result.current.state).toBe('verifying'))
    act(() => result.current.setText('1 Tarmogoyf'))
    expect(result.current.text).toBe('1 Lightning Bolt')
    await act(async () => { release(); await p })
    await waitFor(() => expect(result.current.state).toBe('ready'))
    expect(result.current.run!.cards[0].name).toBe('Lightning Bolt')
  })
  it('shows verify progress and clears it at the end', async () => {
    let release!: () => void
    const base = fakeServices()
    const services = fakeServices({ fetchCard: async (n) => { await new Promise<void>((r) => { release = r }); return base.client.fetchCard(n) } })
    const { result } = hook(services)
    act(() => result.current.setText('1 Lightning Bolt'))
    let p!: Promise<void>; act(() => { p = result.current.verify() })
    await waitFor(() => expect(result.current.verifyProgress).toEqual({ done: 0, total: 1 }))
    await act(async () => { release(); await p })
    await waitFor(() => expect(result.current.verifyProgress).toBeNull())
  })
  it('ignores a second verify while one is running', async () => {
    let calls = 0
    let release!: () => void
    const base = fakeServices()
    const services = fakeServices({ fetchCard: async (n) => { calls++; await new Promise<void>((r) => { release = r }); return base.client.fetchCard(n) } })
    const { result } = hook(services)
    act(() => result.current.setText('1 Lightning Bolt'))
    let p1!: Promise<void>; act(() => { p1 = result.current.verify() })
    await waitFor(() => expect(result.current.state).toBe('verifying'))
    await act(() => result.current.verify())
    await act(async () => { release(); await p1 })
    expect(calls).toBe(1)
    await waitFor(() => expect(result.current.state).toBe('ready'))
  })
})

describe('useDeck suggestions', () => {
  it('applySuggestion rewrites every line with that name and removes the row; the dialog closes when none remain', async () => {
    const { result } = hook()
    act(() => result.current.setText('4 Lightnin Bolt (STA) 42\n1 Tarmogoyf\n2 lightnin bolt'))
    await act(() => result.current.verify())
    const issue = result.current.issues![0]
    expect(issue.kind).toBe('not-found')
    act(() => result.current.applySuggestion(issue as Extract<typeof issue, { kind: 'not-found' }>))
    expect(result.current.text).toBe('4 Lightning Bolt\n1 Tarmogoyf\n2 Lightning Bolt')
    expect(result.current.issues).toBeNull()
    expect(result.current.state).toBe('editing')
  })
  it('applyAllSuggestions fixes every suggested line and keeps the rows without a suggestion', async () => {
    const { result } = hook()
    act(() => result.current.setText('1 Lightnin Bolt\n1 Tarmogoyff\n1 Zzzzqqq\n0 Forest'))
    await act(() => result.current.verify())
    act(() => result.current.applyAllSuggestions())
    expect(result.current.text).toBe('1 Lightning Bolt\n1 Tarmogoyf\n1 Zzzzqqq\n0 Forest')
    expect(result.current.issues!.map((i) => i.line)).toEqual([3, 4])
  })
  it('closeIssues clears the dialog and leaves the list editing', async () => {
    const { result } = hook()
    act(() => result.current.setText('1 Zzzzqqq'))
    await act(() => result.current.verify())
    act(() => result.current.closeIssues())
    expect(result.current.issues).toBeNull()
    expect(result.current.state).toBe('editing')
  })
})
