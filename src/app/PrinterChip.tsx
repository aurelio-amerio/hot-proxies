import { useState, type MouseEvent } from 'react'
import Chip from '@mui/material/Chip'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Tooltip from '@mui/material/Tooltip'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import BluetoothIcon from '@mui/icons-material/Bluetooth'
import BluetoothConnectedIcon from '@mui/icons-material/BluetoothConnected'
import BluetoothDisabledIcon from '@mui/icons-material/BluetoothDisabled'
import BluetoothSearchingIcon from '@mui/icons-material/BluetoothSearching'
import type { PrinterState } from '../core/printer/transport'

export interface PrinterChipProps {
  state: PrinterState
  name: string | null
  onConnect(): void
  onDisconnect(): void
}

export const UNSUPPORTED_HINT = 'Printing needs Chrome on Android or desktop over https'

export function chipLabel(state: PrinterState, name: string | null): string {
  switch (state) {
    case 'unsupported': return 'No Bluetooth'
    case 'disconnected': return name ? `${name}: tap to reconnect` : 'Connect printer'
    case 'connecting': return 'Connecting…'
    case 'connected': return name ?? 'Connected'
    case 'printing': return `${name ?? 'Printer'}: printing`
  }
}

function iconFor(state: PrinterState) {
  if (state === 'unsupported') return <BluetoothDisabledIcon />
  if (state === 'connecting') return <BluetoothSearchingIcon />
  if (state === 'disconnected') return <BluetoothIcon />
  return <BluetoothConnectedIcon />
}

/** App-bar status chip: the only entry point for connecting to the printer. */
export function PrinterChip({ state, name, onConnect, onDisconnect }: PrinterChipProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const narrow = useMediaQuery(useTheme().breakpoints.down('sm'))
  const label = chipLabel(state, name)
  const clickable = state === 'disconnected' || state === 'connected'
  const onClick = (e: MouseEvent<HTMLElement>) => {
    if (state === 'disconnected') onConnect()
    else if (state === 'connected') setAnchor(e.currentTarget)
  }
  return (
    <>
      <Tooltip title={state === 'unsupported' ? UNSUPPORTED_HINT : label}>
        <span>
          <Chip
            icon={iconFor(state)}
            label={narrow ? undefined : label}
            aria-label={label}
            color={state === 'connected' || state === 'printing' ? 'success' : 'default'}
            variant="outlined"
            clickable={clickable}
            disabled={state === 'unsupported'}
            onClick={clickable ? onClick : undefined}
            sx={{ color: 'inherit', borderColor: 'currentColor', mr: 1, '& .MuiChip-icon': { color: 'inherit' } }}
          />
        </span>
      </Tooltip>
      <Menu open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}>
        <MenuItem onClick={() => { setAnchor(null); onDisconnect() }}>Disconnect</MenuItem>
      </Menu>
    </>
  )
}
