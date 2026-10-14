import { useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import DownloadIcon from '@mui/icons-material/Download'
import PrintIcon from '@mui/icons-material/Print'
import LinearProgress from '@mui/material/LinearProgress'
import type { PrinterState } from '../core/printer/transport'
import type { BitImage } from '../core/art/types'
import { bitImageToImageData } from '../core/output/packed'

export interface PreviewPrintProps { state: PrinterState; progress: number; onPrint(): void; onCancel(): void }
export interface PreviewProps { bits: BitImage; cardName: string; dotsPerLine: number; dpi: number; print?: PreviewPrintProps }

export function Preview({ bits, cardName, dotsPerLine, dpi, print }: PreviewProps) {
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
  const download = () => {
    ref.current?.toBlob((blob) => {
      if (!blob) return
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob); a.download = `${cardName.replace(/[^\w\- ]+/g, '').trim() || 'proxy'}.png`
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    }, 'image/png')
  }
  return (
    <Stack spacing={1} sx={{ alignItems: 'center' }} data-testid="preview">
      <Box component="canvas" ref={ref} sx={{ width: widthCss, height: 'auto', imageRendering: 'pixelated', border: '1px solid #ccc', background: '#fff' }} />
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
        <ToggleButtonGroup size="small" exclusive value={zoom} onChange={(_e, v) => v && setZoom(v)}>
          <ToggleButton value="1">1×</ToggleButton><ToggleButton value="2">2×</ToggleButton><ToggleButton value="physical">Print size</ToggleButton>
        </ToggleButtonGroup>
        <Button variant="contained" startIcon={<DownloadIcon />} onClick={download}>Download PNG</Button>
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
