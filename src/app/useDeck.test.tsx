// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useDeck, DECK_TEXT_KEY } from './useDeck'
import { DEFAULT_SETTINGS } from '../core/settings'
import { NetworkError } from '../core/errors'
import { fakeServices, memoryStorage, FAKE_GREY } from '../../tests/fakeServices'
import { setPreferredArt } from '../core/art/preference'
import { fakePrinter } from '../../tests/fakePrinter'
import { encodeEscPosFrames } from '../core/output/escpos'
import { toPacked } from '../core/output/packed'

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

async function verified(text: string, services = fakeServices()) {
  const r = hook(services)
  act(() => r.result.current.setText(text))
  await act(() => r.result.current.verify())
  await waitFor(() => expect(r.result.current.state).toBe('ready'))
  await waitFor(() => expect(r.result.current.rendering).toBe(false))
  return r
}
const totalBytes = (p: ReturnType<typeof fakePrinter>) => p.writes.reduce((a, w) => a + w.length, 0)
const countResets = (p: ReturnType<typeof fakePrinter>) => p.writes.filter((w) => w.length === 5 && w[0] === 0x1b && w[1] === 0x40).length

describe('useDeck thumbnails', () => {
  it('renders one thumbnail per distinct card from the same bits that print, flagging missing art', async () => {
    const { result } = await verified('2 Lightning Bolt\n1 Forest')
    expect([...result.current.thumbs.keys()]).toEqual(['lightning bolt', 'forest'])
    const t = result.current.thumbs.get('lightning bolt')!
    expect(t.bits.width).toBe(384); expect(t.bits.height).toBe(536)
    expect(t.artMissing).toBe(true)    // bolt has art_crop but the fake art fetch fails
    expect(result.current.thumbs.get('forest')!.artMissing).toBe(true)
  })
  it('re-renders on a settings change without resetting statuses', async () => {
    const services = fakeServices()
    const { result, rerender } = renderHook(({ s }) => useDeck(services, s), { initialProps: { s: DEFAULT_SETTINGS } })
    act(() => result.current.setText('2 Lightning Bolt'))
    await act(() => result.current.verify())
    await waitFor(() => expect(result.current.rendering).toBe(false))
    const before = result.current.thumbs.get('lightning bolt')!.bits
    await act(() => result.current.print())
    expect(result.current.state).toBe('done')
    rerender({ s: { ...DEFAULT_SETTINGS, textSize: DEFAULT_SETTINGS.textSize - 4 } })
    await waitFor(() => expect(result.current.thumbs.get('lightning bolt')!.bits).not.toBe(before))
    expect(result.current.run!.items.every((i) => i.status === 'printed')).toBe(true)
  })
})

describe('useDeck print', () => {
  it('prints every pending copy in order with one init, gap feeds between cards and the tail feed last', async () => {
    const printer = fakePrinter('connected')
    const { result } = await verified('2 Lightning Bolt\n1 Forest', fakeServices({ printer }))
    await act(() => result.current.print())
    expect(result.current.state).toBe('done')
    expect(countResets(printer)).toBe(1)
    const single = encodeEscPosFrames(toPacked(result.current.thumbs.get('forest')!.bits), 384, 536).reduce((a, f) => a + f.length, 0)
    // 3 cards: one init (5) + 3 × (raster 25800 + feed 3)
    expect(totalBytes(printer)).toBe(5 + 3 * (single - 5))
    const feeds = printer.writes.filter((w) => w.length === 3 && w[0] === 0x1b && w[1] === 0x64).map((w) => w[2])
    expect(feeds.length).toBe(3)
    expect(feeds[2]).toBe(2)   // FEED_LINES_AFTER on the last card
    expect(result.current.run!.items.map((i) => i.status)).toEqual(['printed', 'printed', 'printed'])
  })
  it('skips deselected cards and disables printing when nothing is selected', async () => {
    const printer = fakePrinter('connected')
    const { result } = await verified('1 Lightning Bolt\n1 Forest', fakeServices({ printer }))
    act(() => result.current.toggleCard('lightning bolt'))
    await act(() => result.current.print())
    expect(result.current.run!.items.map((i) => i.status)).toEqual(['skipped', 'printed'])
    act(() => result.current.startOver())
    act(() => result.current.toggleCard('forest'))
    const before = printer.writes.length
    await act(() => result.current.print())
    expect(printer.writes.length).toBe(before)
    expect(result.current.state).toBe('ready')
  })
  it('ignores a second print() while printing', async () => {
    const printer = fakePrinter('connected')
    let release!: () => void; let gated = true
    const origWrite = printer.write.bind(printer)
    printer.write = async (b) => { if (gated) { gated = false; await new Promise<void>((r) => { release = r }) } await origWrite(b) }
    const { result } = await verified('1 Lightning Bolt', fakeServices({ printer }))
    let p1!: Promise<void>; act(() => { p1 = result.current.print() })
    await waitFor(() => expect(result.current.state).toBe('printing'))
    await act(() => result.current.print())
    await act(async () => { release(); await p1 })
    expect(result.current.state).toBe('done')
    expect(countResets(printer)).toBe(1)
  })
  it('cancel pauses after the current card, leaves it pending, and resume reprints it without a second ESC @ (same connection)', async () => {
    const printer = fakePrinter('connected')
    const { result } = await verified('3 Lightning Bolt', fakeServices({ printer }))
    let seenFirstChunk = false
    const origWrite = printer.write.bind(printer)
    printer.write = async (b) => { await origWrite(b); if (!seenFirstChunk && b.length === 100) { seenFirstChunk = true; result.current.cancel() } }
    await act(() => result.current.print())
    expect(result.current.state).toBe('paused')
    expect(result.current.run!.items.map((i) => i.status)).toEqual(['pending', 'pending', 'pending'])
    expect(result.current.error).toBeNull()
    // frames after the init: first raster block, then the feed that clears the head
    expect(printer.writes.slice(-1)[0].length).toBe(3)
    printer.write = origWrite
    await act(() => result.current.print())
    expect(result.current.state).toBe('done')
    expect(countResets(printer)).toBe(1)
  })
  it('re-including a card after the run is done lets it print on its own', async () => {
    const printer = fakePrinter('connected')
    const { result } = await verified('1 Lightning Bolt\n1 Forest', fakeServices({ printer }))
    act(() => result.current.toggleCard('forest'))
    await act(() => result.current.print())
    expect(result.current.state).toBe('done')
    act(() => result.current.toggleCard('forest'))
    expect(result.current.state).toBe('paused')
    await act(() => result.current.print())
    expect(result.current.state).toBe('done')
    expect(result.current.run!.items.map((i) => i.status)).toEqual(['printed', 'printed'])
  })
  it('deselecting every remaining card of a paused run finishes it', async () => {
    const printer = fakePrinter('connected')
    const { result } = await verified('1 Lightning Bolt\n1 Forest', fakeServices({ printer }))
    const origWrite = printer.write.bind(printer)
    printer.write = async (b) => { await origWrite(b); if (b[0] === 0x1b && b[1] === 0x64) result.current.cancel() }   // cancel after the first card's feed
    await act(() => result.current.print())
    expect(result.current.state).toBe('paused')
    expect(result.current.run!.items.map((i) => i.status)).toEqual(['printed', 'pending'])
    act(() => result.current.toggleCard('forest'))
    expect(result.current.state).toBe('done')
  })
  it('starts every new run (after Start over) with ESC @', async () => {
    const printer = fakePrinter('connected')
    const { result } = await verified('1 Lightning Bolt', fakeServices({ printer }))
    await act(() => result.current.print())
    act(() => result.current.startOver())
    await act(() => result.current.print())
    expect(countResets(printer)).toBe(2)
  })
  it('a dropped connection pauses with the message, the card stays pending, and resume continues after reconnecting', async () => {
    const printer = fakePrinter('connected')
    const { result } = await verified('1 Lightning Bolt\n1 Forest', fakeServices({ printer }))
    const origWrite = printer.write.bind(printer)
    let n = 0
    printer.write = async (b) => { if (++n === 3) { printer.set('disconnected'); throw new Error('gatt gone') } await origWrite(b) }
    await act(() => result.current.print())
    expect(result.current.state).toBe('paused')
    expect(result.current.error).toBe('Printer disconnected during printing. Reconnect and print again.')
    expect(result.current.run!.items.map((i) => i.status)).toEqual(['pending', 'pending'])
    printer.write = origWrite; printer.set('connected')
    await act(() => result.current.print())
    expect(result.current.state).toBe('done')
    expect(result.current.run!.items.map((i) => i.status)).toEqual(['printed', 'printed'])
    expect(countResets(printer)).toBe(2)   // the printer may have power-cycled: resume re-initialises
  })
  it('does nothing when the printer is not connected', async () => {
    const printer = fakePrinter('disconnected')
    const { result } = await verified('1 Lightning Bolt', fakeServices({ printer }))
    await act(() => result.current.print())
    expect(result.current.state).toBe('ready')
    expect(printer.writes.length).toBe(0)
  })
  it('startOver returns to ready with everything pending', async () => {
    const { result } = await verified('1 Lightning Bolt')
    await act(() => result.current.print())
    expect(result.current.state).toBe('done')
    act(() => result.current.startOver())
    expect(result.current.state).toBe('ready')
    expect(result.current.run!.items[0].status).toBe('pending')
  })
  it('toggleCard is ignored while printing', async () => {
    const printer = fakePrinter('connected')
    let release!: () => void; let gated = true
    const origWrite = printer.write.bind(printer)
    printer.write = async (b) => { if (gated) { gated = false; await new Promise<void>((r) => { release = r }) } await origWrite(b) }
    const { result } = await verified('1 Lightning Bolt\n1 Forest', fakeServices({ printer }))
    let p!: Promise<void>; act(() => { p = result.current.print() })
    await waitFor(() => expect(result.current.state).toBe('printing'))
    act(() => result.current.toggleCard('forest'))
    expect(result.current.run!.excluded.has('forest')).toBe(false)
    await act(async () => { release(); await p })
  })
})

describe('useDeck art preference', () => {
  it('fetches the remembered printing for a card during verify', async () => {
    const storage = memoryStorage(); setPreferredArt(storage, 'Lightning Bolt', 'ref1')
    const fetchArtById = vi.fn(async () => new Blob([new Uint8Array([1])]))
    const { result } = hook(fakeServices({ storage, fetchArtById, decodeArt: async () => FAKE_GREY }))
    act(() => result.current.setText('1 Lightning Bolt\n1 Forest'))
    await act(() => result.current.verify())
    await waitFor(() => expect(result.current.state).toBe('ready'))
    expect(fetchArtById).toHaveBeenCalledTimes(1)
    expect(fetchArtById).toHaveBeenCalledWith('ref1')
    expect(result.current.run!.cards.find((c) => c.name === 'Lightning Bolt')!.art).toBe(FAKE_GREY)
    expect(result.current.run!.cards.find((c) => c.name === 'Forest')!.art).toBeNull()
  })
})
