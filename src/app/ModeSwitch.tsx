import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import StyleIcon from '@mui/icons-material/Style'
import LayersIcon from '@mui/icons-material/Layers'
import TokenIcon from '@mui/icons-material/Token'
import type { Mode } from './useMode'

export interface ModeSwitchProps { mode: Mode; onChange(m: Mode): void }

const MODES: { value: Mode; label: string; icon: React.ReactElement }[] = [
  { value: 'card', label: 'Card', icon: <StyleIcon /> },
  { value: 'deck', label: 'Deck', icon: <LayersIcon /> },
  { value: 'tokens', label: 'Tokens', icon: <TokenIcon /> },
]

/** Card | Deck | Tokens switch, styled as a row of three chips to sit beside the printer chip. */
export function ModeSwitch({ mode, onChange }: ModeSwitchProps) {
  return (
    <Stack direction="row" spacing={0.5} role="group" aria-label="Mode" data-testid="mode-switch">
      {MODES.map((m) => {
        const on = mode === m.value
        return (
          <Chip key={m.value} icon={m.icon} label={m.label} aria-pressed={on}
            color={on ? 'primary' : 'default'} variant="outlined" clickable
            onClick={() => { if (!on) onChange(m.value) }} />
        )
      })}
    </Stack>
  )
}
