import { describe, it, expect } from 'vitest'
import { loadCard } from './loadCard'
import { fakeServices } from '../../tests/fakeServices'
import { UnsupportedLayout } from '../core/errors'
import { sheetFaces } from '../core/card/types'

describe('loadCard', () => {
  it('loads a plain card as one sheet', async () => {
    const { card, meldFailed } = await loadCard(fakeServices(), 'Lightning Bolt')
    expect(card.sheets).toHaveLength(1); expect(meldFailed).toBe(false)
  })
  it('attaches the melded card as the back of a meld part', async () => {
    const { card, meldFailed } = await loadCard(fakeServices(), 'Hanweir Battlements')
    expect(meldFailed).toBe(false); expect(card.sheets).toHaveLength(2)
    expect(sheetFaces(card.sheets[1]!)[0].name).toBe('Hanweir, the Writhing Township')
  })
  it('keeps one sheet and flags meldFailed when the melded card cannot be fetched', async () => {
    const s = fakeServices({ fetchCardById: async () => { throw new Error('offline') } })
    const { card, meldFailed } = await loadCard(s, 'Hanweir Battlements')
    expect(card.sheets).toHaveLength(1); expect(meldFailed).toBe(true)
  })
  it('rejects unsupported layouts', async () => {
    await expect(loadCard(fakeServices(), 'Academy at Tolaria West')).rejects.toBeInstanceOf(UnsupportedLayout)
  })
})
