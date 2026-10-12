import { useEffect, useState } from 'react'
import Drawer from '@mui/material/Drawer'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Slider from '@mui/material/Slider'
import Switch from '@mui/material/Switch'
import FormControlLabel from '@mui/material/FormControlLabel'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import { DITHER_NAMES, RANGES, type Settings } from '../core/settings'

export interface SettingsDrawerProps { open: boolean; onClose(): void; settings: Settings; update(p: Partial<Settings>): void; reset(): void }

function Range({ label, value, range, step, onChange }: { label: string; value: number; range: readonly [number, number]; step: number; onChange(v: number): void }) {
  return (
    <Stack>
      <Typography variant="caption">{label}: {value}</Typography>
      <Slider size="small" min={range[0]} max={range[1]} step={step} value={value} onChange={(_e, v) => onChange(v as number)} />
    </Stack>
  )
}

/** Number input that keeps the raw text while typing and commits on blur or Enter, so clamping never fights the keyboard. */
function NumberField({ label, value, onCommit }: { label: string; value: number; onCommit(v: number): void }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = () => {
    const n = Number(text)
    if (text.trim() === '' || !Number.isFinite(n)) setText(String(value))
    else { onCommit(n); setText(String(value)) }
  }
  return (
    <TextField size="small" type="number" label={label} value={text}
      onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit() }} />
  )
}

export function SettingsDrawer({ open, onClose, settings: s, update, reset }: SettingsDrawerProps) {
  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Stack spacing={2} sx={{ width: 300, p: 2 }}>
        <Typography variant="h6">Settings</Typography>
        <Typography variant="overline">Art</Typography>
        <TextField select size="small" label="Dither" value={s.dither} onChange={(e) => update({ dither: e.target.value as Settings['dither'] })}>
          {DITHER_NAMES.map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Block size" value={s.block} onChange={(e) => update({ block: Number(e.target.value) as 1 | 2 })}>
          <MenuItem value={1}>1 dot</MenuItem><MenuItem value={2}>2 × 2 dots</MenuItem>
        </TextField>
        <Range label="Gamma" value={s.gamma} range={RANGES.gamma} step={0.05} onChange={(v) => update({ gamma: v })} />
        <Range label="Contrast cutoff %" value={s.contrastCutoff} range={RANGES.contrastCutoff} step={0.5} onChange={(v) => update({ contrastCutoff: v })} />
        <Divider />
        <Typography variant="overline">Text</Typography>
        <Range label="Rules text size" value={s.textSize} range={RANGES.textSize} step={1} onChange={(v) => update({ textSize: v })} />
        <Range label="Name size" value={s.nameSize} range={RANGES.nameSize} step={1} onChange={(v) => update({ nameSize: v })} />
        <FormControlLabel control={<Switch checked={s.stripReminder} onChange={(e) => update({ stripReminder: e.target.checked })} />} label="Strip reminder text" />
        <TextField select size="small" label="Font" value={s.fontFamily} onChange={(e) => update({ fontFamily: e.target.value as Settings['fontFamily'] })}>
          <MenuItem value="ProxySerif">Crimson Text</MenuItem><MenuItem value="MPlantin">MPlantin (local only)</MenuItem>
        </TextField>
        <Divider />
        <Typography variant="overline">Printer</Typography>
        <NumberField label="Dots per line" value={s.dotsPerLine} onCommit={(v) => update({ dotsPerLine: v })} />
        <NumberField label="DPI" value={s.dpi} onCommit={(v) => update({ dpi: v })} />
        <Button onClick={reset}>Reset to defaults</Button>
      </Stack>
    </Drawer>
  )
}
