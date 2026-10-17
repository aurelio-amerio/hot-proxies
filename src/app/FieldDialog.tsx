import { useState } from 'react'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import type { CardData } from '../core/card/types'
import type { DraftPatch } from '../core/token/draft'

export type FieldKind = 'name' | 'type' | 'rules' | 'stat'
export interface FieldDialogProps { field: FieldKind | null; card: CardData; onSave(patch: DraftPatch): void; onClose(): void }

const TITLES: Record<FieldKind, string> = { name: 'Name', type: 'Type line', rules: 'Rules text', stat: 'Power and toughness' }
type StatKind = 'none' | 'pt' | 'loyalty'

/** One dialog per hotspot. Remounted per field (key) so its state starts from the card every time it opens. */
export function FieldDialog({ field, card, onSave, onClose }: FieldDialogProps) {
  return (
    <Dialog open={field !== null} onClose={onClose} fullWidth maxWidth="xs" aria-labelledby="field-dialog-title">
      {field && <FieldForm key={field} field={field} card={card} onSave={onSave} onClose={onClose} />}
    </Dialog>
  )
}

function FieldForm({ field, card, onSave, onClose }: { field: FieldKind; card: CardData; onSave(p: DraftPatch): void; onClose(): void }) {
  const initialText = field === 'name' ? card.name : field === 'type' ? card.typeLine : field === 'rules' ? card.oracleText : ''
  const [text, setText] = useState(initialText)
  const [statKind, setStatKind] = useState<StatKind>(card.stat?.kind === 'pt' || card.stat?.kind === 'loyalty' ? card.stat.kind : 'none')  // tokens have no defense
  const [power, setPower] = useState(card.stat?.kind === 'pt' ? card.stat.power : '')
  const [toughness, setToughness] = useState(card.stat?.kind === 'pt' ? card.stat.toughness : '')
  const [loyalty, setLoyalty] = useState(card.stat?.kind === 'loyalty' ? card.stat.value : '')
  const canSave = field !== 'name' || text.trim().length > 0

  const patch = (): DraftPatch => {
    if (field === 'name') return { name: text }
    if (field === 'type') return { typeLine: text }
    if (field === 'rules') return { oracleText: text }
    if (statKind === 'pt') return { stat: { kind: 'pt', power, toughness } }
    if (statKind === 'loyalty') return { stat: { kind: 'loyalty', value: loyalty } }
    return { stat: { kind: 'none' } }
  }
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (canSave) onSave(patch()) }

  return (
    <form onSubmit={submit}>
      <DialogTitle id="field-dialog-title">{TITLES[field]}</DialogTitle>
      <DialogContent>
        {field === 'name' && <TextField autoFocus fullWidth label="Name" value={text} onChange={(e) => setText(e.target.value)} />}
        {field === 'type' && <TextField autoFocus fullWidth label="Type line" value={text} onChange={(e) => setText(e.target.value)} />}
        {field === 'rules' && (
          <TextField autoFocus fullWidth multiline minRows={6} label="Rules text" value={text} onChange={(e) => setText(e.target.value)}
            helperText="Mana symbols like {T} or {G} are drawn as icons." />
        )}
        {field === 'stat' && (
          <Stack spacing={2}>
            <ToggleButtonGroup exclusive size="small" value={statKind} onChange={(_e, v: StatKind | null) => { if (v) setStatKind(v) }} aria-label="Stat kind">
              <ToggleButton value="none">None</ToggleButton>
              <ToggleButton value="pt">P/T</ToggleButton>
              <ToggleButton value="loyalty">Loyalty</ToggleButton>
            </ToggleButtonGroup>
            {statKind === 'pt' && (
              <Stack direction="row" spacing={1}>
                <TextField autoFocus label="Power" value={power} onChange={(e) => setPower(e.target.value)} />
                <TextField label="Toughness" value={toughness} onChange={(e) => setToughness(e.target.value)} />
              </Stack>
            )}
            {statKind === 'loyalty' && <TextField autoFocus label="Loyalty" value={loyalty} onChange={(e) => setLoyalty(e.target.value)} />}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="contained" disabled={!canSave}>Save</Button>
      </DialogActions>
    </form>
  )
}
