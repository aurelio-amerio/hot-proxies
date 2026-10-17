import Box from '@mui/material/Box'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import LinearProgress from '@mui/material/LinearProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { RULE } from './theme'

export interface ArtOption { ref: string; thumbUrl: string; label: string; group?: string }
export interface ArtPickerDialogProps {
  open: boolean
  /** null while loading */
  options: ArtOption[] | null
  error?: string | null
  current: string | null
  /** Text of the leading tile that clears the choice: "No art" in Tokens, "Default art" in Card mode. */
  noneLabel: string
  onPick(ref: string | null): void
  onClose(): void
}

const TILE_W = 120, TILE_H = 88

function Tile({ label, pressed, onClick, children }: { label: string; pressed: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <Box component="button" type="button" aria-label={label} aria-pressed={pressed} onClick={onClick}
      sx={{ flex: '0 0 auto', width: TILE_W, height: TILE_H, p: 0, overflow: 'hidden', cursor: 'pointer', background: '#fff', borderRadius: 1,
        border: 2, borderStyle: 'solid', borderColor: pressed ? 'primary.main' : RULE, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
      {children}
    </Box>
  )
}

/** A horizontal scroller of colour art crops; the plain crops are easier to tell apart than dithered ones. */
export function ArtPickerDialog({ open, options, error, current, noneLabel, onPick, onClose }: ArtPickerDialogProps) {
  const pick = (ref: string | null) => { onPick(ref); onClose() }
  let lastGroup: string | undefined
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="art-picker-title">
      <DialogTitle id="art-picker-title">Choose art</DialogTitle>
      <DialogContent>
        {error && <Typography color="error" sx={{ mb: 1 }}>{error}</Typography>}
        {!error && options === null && <LinearProgress aria-label="Loading printings" sx={{ mb: 1 }} />}
        <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', py: 1, alignItems: 'center' }}>
          <Tile label={noneLabel} pressed={current === null} onClick={() => pick(null)}>
            <Typography variant="body2">{noneLabel}</Typography>
          </Tile>
          {(options ?? []).map((o) => {
            const heading = o.group && o.group !== lastGroup ? o.group : null
            lastGroup = o.group
            return (
              <Stack key={o.ref} direction="row" spacing={1} sx={{ alignItems: 'center', flex: '0 0 auto' }}>
                {heading && <Typography variant="caption" color="text.secondary" sx={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', px: 0.5 }}>{heading}</Typography>}
                <Tile label={o.label} pressed={o.ref === current} onClick={() => pick(o.ref)}>
                  <img src={o.thumbUrl} alt={o.label} loading="lazy" width={TILE_W} height={TILE_H} style={{ display: 'block', objectFit: 'cover' }} />
                </Tile>
              </Stack>
            )
          })}
        </Stack>
        {options !== null && options.length === 0 && !error && <Typography color="text.secondary">No printings with art found.</Typography>}
      </DialogContent>
    </Dialog>
  )
}
