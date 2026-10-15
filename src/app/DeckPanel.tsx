import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import LinearProgress from '@mui/material/LinearProgress'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import PrintIcon from '@mui/icons-material/Print'
import type { PrinterState } from '../core/printer/transport'
import type { Settings } from '../core/settings'
import { progress } from '../core/deck/run'
import type { UseDeck } from './useDeck'
import { DeckStrip } from './DeckStrip'
import { DeckIssuesDialog } from './DeckIssuesDialog'
import { Preview } from './Preview'

export const MOXFIELD_HINT = 'Moxfield decks cannot be imported directly. Open the deck on Moxfield, choose Export, copy the list and paste it here.'
const PLACEHOLDER = '4 Lightning Bolt\n1 Sol Ring (C21) 263\n\nSideboard lines are skipped.'

export interface DeckPanelProps { deck: UseDeck; printerState: PrinterState; settings: Settings }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function DeckPanel({ deck, printerState, settings }: DeckPanelProps) {
  const [open, setOpen] = useState<string | null>(null)
  const { state, run, parsed, distinct } = deck
  const busy = state === 'verifying' || state === 'printing'
  const totalEntered = parsed.entries.reduce((a, e) => a + e.count, 0)
  const prog = run ? progress(run) : null
  const allCopies = run ? run.items.length : 0
  const selected = prog ? prog.total : 0

  const summary = (() => {
    if (!run || !prog) return `${plural(totalEntered, 'card')}, ${distinct.length} distinct`
    if (run.excluded.size > 0) return `${selected} of ${allCopies} selected`
    return `${plural(selected, 'card')} ready, ${run.cards.length} distinct`
  })()

  const canPrint = (state === 'ready' || state === 'paused') && printerState === 'connected' && !!prog && prog.remaining > 0 && !deck.rendering
  const currentCard = deck.current && run ? run.cards.find((c) => c.key === deck.current!.item.cardKey) : null
  const openCard = open && run ? run.cards.find((c) => c.key === open) : null
  const openThumb = open ? deck.thumbs.get(open) : undefined

  return (
    <Stack spacing={2}>
      <TextField multiline minRows={6} maxRows={14} label="Deck list" placeholder={PLACEHOLDER} value={deck.text}
        onChange={(e) => deck.setText(e.target.value)} slotProps={{ input: { readOnly: busy, sx: { fontFamily: 'monospace', fontSize: 14 } } }} />
      {parsed.moxfieldUrl && <Alert severity="info">{MOXFIELD_HINT}</Alert>}
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <Stack>
          <Typography color="text.secondary">{summary}</Typography>
          {parsed.issues.length > 0 && !run && <Typography color="warning.main" variant="body2">{`${plural(parsed.issues.length, 'line')} ${parsed.issues.length === 1 ? 'has' : 'have'} problems`}</Typography>}
        </Stack>
        {state === 'editing' && (
          <Button variant="contained" disabled={parsed.entries.length === 0} onClick={() => { void deck.verify() }}>Verify</Button>
        )}
      </Stack>
      {state === 'verifying' && deck.verifyProgress && (
        <Stack spacing={0.5}>
          <Typography variant="body2" color="text.secondary">{`Checking ${deck.verifyProgress.done} of ${deck.verifyProgress.total}`}</Typography>
          <LinearProgress variant="determinate" value={deck.verifyProgress.total ? (100 * deck.verifyProgress.done) / deck.verifyProgress.total : 0} aria-label="Verify progress" />
        </Stack>
      )}
      {deck.error && <Alert severity="error" onClose={deck.clearError}>{deck.error}</Alert>}
      {deck.fontWarning && <Alert severity="info">{deck.fontWarning}</Alert>}
      {run && (
        <>
          <DeckStrip cards={run.cards} thumbs={deck.thumbs} excluded={run.excluded} currentKey={deck.current?.item.cardKey ?? null}
            disabled={state === 'printing'} onToggle={deck.toggleCard} onOpen={setOpen} />
          {deck.rendering && <LinearProgress aria-label="Rendering" />}
          {printerState !== 'unsupported' && prog && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
              {state === 'printing' && (
                <Stack spacing={0.5} sx={{ flexGrow: 1, minWidth: 220 }}>
                  <Typography variant="body2">{`Card ${prog.printed + 1} of ${prog.total} · ${currentCard?.name ?? ''}`}</Typography>
                  <LinearProgress variant="determinate" value={(deck.current?.fraction ?? 0) * 100} aria-label="Print progress" />
                </Stack>
              )}
              {state === 'printing' && <Button size="small" onClick={deck.cancel}>Cancel</Button>}
              {state === 'ready' && (
                <Button variant="contained" startIcon={<PrintIcon />} disabled={!canPrint} onClick={() => { void deck.print() }}>{`Print ${prog.total} cards`}</Button>
              )}
              {state === 'paused' && (
                <Button variant="contained" startIcon={<PrintIcon />} disabled={!canPrint} onClick={() => { void deck.print() }}>{`Resume from card ${prog.printed + 1}`}</Button>
              )}
              {state === 'done' && <Typography>{`${plural(prog.printed, 'card')} printed`}</Typography>}
              {(state === 'paused' || state === 'done') && <Button onClick={deck.startOver}>Start over</Button>}
            </Stack>
          )}
        </>
      )}
      <DeckIssuesDialog issues={deck.issues} onApply={deck.applySuggestion} onApplyAll={deck.applyAllSuggestions} onClose={deck.closeIssues} />
      <Dialog open={!!openCard} onClose={() => setOpen(null)} aria-labelledby="deck-preview-title" maxWidth="md">
        <DialogTitle id="deck-preview-title">{openCard?.name ?? ''}</DialogTitle>
        <DialogContent>
          {openThumb && <Preview bits={openThumb.bits} dotsPerLine={settings.dotsPerLine} dpi={settings.dpi} />}
        </DialogContent>
      </Dialog>
    </Stack>
  )
}
