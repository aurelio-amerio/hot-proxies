import { useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import PrintIcon from '@mui/icons-material/Print'
import LinearProgress from '@mui/material/LinearProgress'
import type { PrinterState } from '../core/printer/transport'
import type { BitImage } from '../core/art/types'
import { bitImageToImageData } from '../core/output/packed'
import { RULE } from './theme'

export interface PreviewPrintProps { state: PrinterState; progress: number; onPrint(): void; onCancel(): void }
export interface PreviewProps { bits: BitImage; dotsPerLine: number; dpi: number; print?: PreviewPrintProps }

export function Preview({ bits, dotsPerLine, dpi, print }: PreviewProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState<'1' | '2' | 'physical'>('1')
  useEffect(() => {
    const c = ref.current; if (!c) return
    c.width = bits.width; c.height = bits.height
    const ctx = c.getContext?.('2d')
    if (!ctx || typeof ImageData === 'undefined') return   // jsdom has no canvas
    const id = bitImageToImageData(bits)
    ctx.putImageData(new ImageData(id.data as Uint8ClampedArray<ArrayBuffer>, id.width, id.height), 0, 0)
  }, [bits])
  const widthCss = zoom === 'physical' ? `${((dotsPerLine / dpi) * 25.4).toFixed(2)}mm` : `${bits.width * Number(zoom)}px`
  return (
    <Stack spacing={1} sx={{ alignItems: 'center' }} data-testid="preview">
      <Box component="canvas" ref={ref} sx={{ width: widthCss, maxWidth: '100%', height: 'auto', imageRendering: 'pixelated', border: `1px solid ${RULE}`, background: '#fff', boxShadow: '0 4px 14px rgba(40, 32, 16, 0.15)' }} />
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
        <ToggleButtonGroup size="small" exclusive value={zoom} onChange={(_e, v) => v && setZoom(v)}>
          <ToggleButton value="1">1×</ToggleButton><ToggleButton value="2">2×</ToggleButton><ToggleButton value="physical">Print size</ToggleButton>
        </ToggleButtonGroup>
        {print && print.state !== 'unsupported' && (
          print.state === 'printing'
            ? <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 180 }}>
                <LinearProgress variant="determinate" value={print.progress * 100} aria-label="Print progress" sx={{ flexGrow: 1 }} />
                <Button size="small" onClick={print.onCancel}>Cancel</Button>
              </Stack>
            : <Button variant="contained" startIcon={<PrintIcon />} disabled={print.state !== 'connected'} onClick={print.onPrint}>Print</Button>
        )}
      </Stack>
    </Stack>
  )
}
