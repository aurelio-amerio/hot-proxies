import { useState } from 'react'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Divider from '@mui/material/Divider'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Alert from '@mui/material/Alert'
import LinearProgress from '@mui/material/LinearProgress'
import Snackbar from '@mui/material/Snackbar'
import SettingsIcon from '@mui/icons-material/Settings'
import { SHEET_SHADOW, theme } from './theme'
import headerImg from '../assets/header.jpg'
import type { Services } from './services'
import { useSettings } from './useSettings'
import { useProxy } from './useProxy'
import { usePrinter } from './usePrinter'
import { PrinterChip } from './PrinterChip'
import { SearchBox } from './SearchBox'
import { EditablePreview } from './EditablePreview'
import { ArtPickerDialog } from './ArtPickerDialog'
import { SettingsDrawer } from './SettingsDrawer'
import { useMode } from './useMode'
import { useDeck } from './useDeck'
import { DeckPanel } from './DeckPanel'
import { ModeSwitch } from './ModeSwitch'
import { useTokens } from './useTokens'
import { TokensPanel } from './TokensPanel'

export const REPO_URL = 'https://github.com/aurelio-amerio/hot-proxies'
export const FAN_CONTENT_POLICY_URL = 'https://company.wizards.com/en/legal/fancontentpolicy'

export function App({ services }: { services: Services }) {
  const [settings, update, reset] = useSettings(services.storage)
  const proxy = useProxy(services, settings)
  const { state, card, bits, geometry, errors, render } = proxy
  const [drawer, setDrawer] = useState(false)
  const [artOpen, setArtOpen] = useState(false)
  const printer = usePrinter(services)
  const [mode, setMode] = useMode(services.storage)
  const deck = useDeck(services, settings)
  const tokens = useTokens(services, settings)
  // Verify errors show inline in the deck panel; the snackbar carries print failures from either mode.
  const snack = printer.error ?? (deck.state === 'paused' ? deck.error : null) ?? tokens.printError
  const clearSnack = () => { printer.clearError(); deck.clearError(); tokens.clearPrintError() }
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box component="main" sx={{ maxWidth: 640, mx: 'auto', px: { xs: 1.5, sm: 2 }, pt: { xs: 1.5, sm: 4 }, pb: 6 }}>
        <Paper variant="outlined" sx={{ borderRadius: 4, overflow: 'hidden', boxShadow: SHEET_SHADOW }}>
          {/* The artwork's background is the sheet colour; multiply hides any residual off-white. */}
          <Box component="img" src={headerImg} alt="Hot Proxies!" sx={{ display: 'block', width: '100%', height: 'auto', mixBlendMode: 'multiply' }} />
          <Stack spacing={2} sx={{ px: { xs: 2, sm: 3 }, pb: 3 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <PrinterChip state={printer.state} name={printer.name} onConnect={printer.connect} onDisconnect={printer.disconnect} />
                <ModeSwitch mode={mode} onChange={setMode} />
              </Stack>
              <IconButton aria-label="settings" sx={{ color: 'text.primary' }} onClick={() => setDrawer(true)}><SettingsIcon /></IconButton>
            </Stack>
            <Divider />
            {mode === 'card' && (<>
            <SearchBox loadNames={services.loadNames} onPick={render} />
            {state === 'loading' && <LinearProgress />}
            {errors.map((e, i) => <Alert key={i} severity={state === 'error' ? 'error' : 'info'}>{e.message}</Alert>)}
            {geometry?.overflow && <Alert severity="warning">Rules text was clipped to fit.</Alert>}
            {state === 'idle' && <Typography color="text.secondary">Type a card name to render a proxy.</Typography>}
            {state === 'rendered' && card && bits && geometry && (
              <EditablePreview bits={bits} geometry={geometry} dotsPerLine={settings.dotsPerLine} dpi={settings.dpi}
                enabled={['art']} disabled={printer.state === 'printing'}
                onEdit={() => { setArtOpen(true); void proxy.loadPrints() }}
                print={{ state: printer.state, progress: printer.progress, onPrint: () => { void printer.print(bits) }, onCancel: printer.cancel }} />
            )}
            <ArtPickerDialog open={artOpen && mode === 'card'} current={proxy.artRef} noneLabel="Default art"
              options={proxy.prints?.map((p) => ({ ref: p.ref, thumbUrl: p.artUrl, label: `${p.set.toUpperCase()} ${p.released}` })) ?? null}
              error={proxy.printsError}
              onPick={(ref) => { void proxy.chooseArt(ref) }} onClose={() => setArtOpen(false)} />
            </>)}
            {mode === 'deck' && <DeckPanel deck={deck} printerState={printer.state} settings={settings} />}
            {mode === 'tokens' && <TokensPanel tokens={tokens} printerState={printer.state} settings={settings} />}
          </Stack>
        </Paper>
        <Stack spacing={1} sx={{ mt: 2, px: 1 }}>
          <Typography variant="body2" color="text.secondary" align="center">
            Ink on paper for 58 mm thermal printers · <Link href={REPO_URL} color="inherit">GitHub</Link>
          </Typography>
          <Typography variant="caption" color="text.secondary" align="center" sx={{ display: 'block' }}>
            Hot Proxies is unofficial Fan Content permitted under the <Link href={FAN_CONTENT_POLICY_URL} color="inherit">Fan Content Policy</Link>.
            Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.
          </Typography>
        </Stack>
      </Box>
      <SettingsDrawer open={drawer} onClose={() => setDrawer(false)} settings={settings} update={update} reset={reset} />
      <Snackbar open={!!snack} autoHideDuration={6000} onClose={clearSnack}>
        <Alert severity="error" onClose={clearSnack} variant="filled">{snack}</Alert>
      </Snackbar>
    </ThemeProvider>
  )
}
