import { useState } from 'react'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import AppBar from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import Container from '@mui/material/Container'
import Stack from '@mui/material/Stack'
import Alert from '@mui/material/Alert'
import LinearProgress from '@mui/material/LinearProgress'
import Snackbar from '@mui/material/Snackbar'
import SettingsIcon from '@mui/icons-material/Settings'
import { theme } from './theme'
import headerImg from '../assets/header.jpg'
import type { Services } from './services'
import { useSettings } from './useSettings'
import { useProxy } from './useProxy'
import { usePrinter } from './usePrinter'
import { PrinterChip } from './PrinterChip'
import { SearchBox } from './SearchBox'
import { Preview } from './Preview'
import { SettingsDrawer } from './SettingsDrawer'

export function App({ services }: { services: Services }) {
  const [settings, update, reset] = useSettings(services.storage)
  const { state, card, bits, geometry, errors, render } = useProxy(services, settings)
  const [drawer, setDrawer] = useState(false)
  const printer = usePrinter(services)
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppBar position="static"><Toolbar>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>Hot Proxies</Typography>
        <PrinterChip state={printer.state} name={printer.name} onConnect={printer.connect} onDisconnect={printer.disconnect} />
        <IconButton color="inherit" aria-label="settings" onClick={() => setDrawer(true)}><SettingsIcon /></IconButton>
      </Toolbar></AppBar>
      <Container maxWidth="sm" sx={{ py: 2 }}>
        <Stack spacing={2}>
          <Box component="img" src={headerImg} alt="Hot Proxies!" sx={{ display: 'block', width: '100%', height: 'auto' }} />
          <SearchBox loadNames={services.loadNames} onPick={render} />
          {state === 'loading' && <LinearProgress />}
          {errors.map((e, i) => <Alert key={i} severity={state === 'error' ? 'error' : 'info'}>{e.message}</Alert>)}
          {geometry?.overflow && <Alert severity="warning">Rules text was clipped to fit.</Alert>}
          {state === 'idle' && <Typography color="text.secondary">Type a card name to render a proxy.</Typography>}
          {state === 'rendered' && card && bits && (
            <Preview bits={bits} cardName={card.name} dotsPerLine={settings.dotsPerLine} dpi={settings.dpi}
              print={{ state: printer.state, progress: printer.progress, onPrint: () => { void printer.print(bits) }, onCancel: printer.cancel }} />
          )}
        </Stack>
      </Container>
      <SettingsDrawer open={drawer} onClose={() => setDrawer(false)} settings={settings} update={update} reset={reset} />
      <Snackbar open={!!printer.error} autoHideDuration={6000} onClose={printer.clearError}>
        <Alert severity="error" onClose={printer.clearError} variant="filled">{printer.error}</Alert>
      </Snackbar>
    </ThemeProvider>
  )
}
