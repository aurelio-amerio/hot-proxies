import { useEffect, useRef } from 'react'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import type { BitImage } from '../core/art/types'
import type { DeckCard } from '../core/deck/run'
import type { DeckThumb } from './useDeck'
import { bitImageToImageData } from '../core/output/packed'
import { INK, RULE } from './theme'

export interface DeckStripProps {
  cards: DeckCard[]
  thumbs: Map<string, DeckThumb>
  excluded: ReadonlySet<string>
  currentKey: string | null
  disabled: boolean
  onToggle(key: string): void
  onOpen(key: string): void
}

const THUMB_W = 96   // CSS px; the 63:88 card ratio gives 134 px tall

function Thumb({ bits }: { bits: BitImage }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current; if (!c) return
    c.width = bits.width; c.height = bits.height
    const ctx = c.getContext?.('2d')
    if (!ctx || typeof ImageData === 'undefined') return   // jsdom has no canvas
    const id = bitImageToImageData(bits)
    ctx.putImageData(new ImageData(id.data as Uint8ClampedArray<ArrayBuffer>, id.width, id.height), 0, 0)
  }, [bits])
  return <Box component="canvas" ref={ref} sx={{ width: THUMB_W, height: 'auto', display: 'block', imageRendering: 'pixelated', background: '#fff' }} />
}

function warningText(t: DeckThumb): string | null {
  const parts = [t.overflow ? 'Rules text clipped' : null, t.artMissing ? 'art missing' : null, t.meldFailed ? 'melded side missing' : null].filter((p): p is string => !!p)
  return parts.length ? parts.join('; ') : null
}

/** One thumbnail per distinct card, drawn from the bits that will print (the front sheet of a fold pair). */
export function DeckStrip({ cards, thumbs, excluded, currentKey, disabled, onToggle, onOpen }: DeckStripProps) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ overflowX: 'auto', pb: 1, px: 0.5 }} data-testid="deck-strip">
      {cards.map((c) => {
        const t = thumbs.get(c.key)
        const off = excluded.has(c.key)
        const current = currentKey === c.key
        const warn = t ? warningText(t) : null
        return (
          <Stack key={c.key} spacing={0.5} data-testid={`deck-thumb-${c.key}`} data-current={current ? 'true' : 'false'}
            sx={{ flex: '0 0 auto', width: THUMB_W, opacity: off ? 0.4 : 1, alignItems: 'center' }}>
            <Box sx={{ position: 'relative', border: `${current ? 2 : 1}px solid ${current ? INK : RULE}`, borderRadius: 1, overflow: 'hidden', width: THUMB_W }}>
              <ButtonBase aria-label={`Preview ${c.name}`} onClick={() => onOpen(c.key)} sx={{ display: 'block' }}>
                {t ? <Thumb bits={t.bits[0]} /> : <Box sx={{ width: THUMB_W, height: Math.round((THUMB_W * 88) / 63), bgcolor: 'action.hover' }} />}
              </ButtonBase>
              <Chip label={`×${c.count}`} size="small" sx={{ position: 'absolute', top: 4, right: 4, bgcolor: INK, color: '#fff', height: 20 }} />
              {t?.bits.length === 2 && <Chip label="2 sheets" size="small" sx={{ position: 'absolute', bottom: 4, left: 4, bgcolor: INK, color: '#fff', height: 20 }} />}
              {warn && (
                <Tooltip title={warn}>
                  <WarningAmberIcon aria-label={warn} color="warning" fontSize="small" sx={{ position: 'absolute', bottom: 4, right: 4, bgcolor: '#fff', borderRadius: '50%' }} />
                </Tooltip>
              )}
              <Checkbox size="small" checked={!off} disabled={disabled} onChange={() => onToggle(c.key)}
                slotProps={{ input: { 'aria-label': `Include ${c.name}` } }} sx={{ position: 'absolute', top: 0, left: 0, bgcolor: 'rgba(255,255,255,0.85)', p: 0.25 }} />
            </Box>
            <Typography variant="caption" noWrap sx={{ width: '100%', textAlign: 'center' }} title={c.name}>{c.name}</Typography>
          </Stack>
        )
      })}
    </Stack>
  )
}
