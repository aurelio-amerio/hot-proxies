import { useEffect, useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import type { PrinterState } from '../core/printer/transport'
import type { Settings } from '../core/settings'
import type { CardData } from '../core/card/types'
import type { HotspotKind } from '../core/token/hotspots'
import { variantLabel } from '../core/token/index'
import { COPIES_MIN, COPIES_MAX } from '../core/token/draft'
import { artCropUrl } from '../data/artRef'
import type { UseTokens } from './useTokens'
import { SearchBox } from './SearchBox'
import { EditablePreview } from './EditablePreview'
import { FieldDialog, type FieldKind } from './FieldDialog'
import { ArtPickerDialog, type ArtOption } from './ArtPickerDialog'

export interface TokensPanelProps { tokens: UseTokens; printerState: PrinterState; settings: Settings }

const ALL_HOTSPOTS: HotspotKind[] = ['name', 'art', 'type', 'rules', 'stat']
const EMPTY_CARD: CardData = { name: '', manaCost: '', typeLine: '', oracleText: '' }

export function TokensPanel({ tokens, printerState, settings }: TokensPanelProps) {
  const [field, setField] = useState<FieldKind | null>(null)
  const [artOpen, setArtOpen] = useState(false)
  const { draft, entry, bits, geometry } = tokens
  const busy = tokens.printing
  const [copiesText, setCopiesText] = useState('1')
  useEffect(() => { setCopiesText(String(draft?.copies ?? 1)) }, [draft?.copies])
  const commitCopies = () => {
    const n = Number(copiesText)
    const next = copiesText.trim() === '' || !Number.isFinite(n) ? COPIES_MIN : Math.min(COPIES_MAX, Math.max(COPIES_MIN, Math.round(n)))
    tokens.edit({ copies: next })
    setCopiesText(String(next))
  }
  // A draft restored after tokens.json was rebuilt may point past the current variants: treat the first as current.
  const variantIndex = entry && draft?.base ? (entry.variants[draft.base.variant] ? draft.base.variant : 0) : 0
  const variantKnown = !!entry && !!draft?.base && !!entry.variants[draft.base.variant]

  const artOptions = useMemo<ArtOption[]>(() => {
    if (!entry) return []
    const current = entry.variants[variantIndex]
    const refs = [
      ...current.prints.map((ref) => ({ ref, group: 'This variant' })),
      ...entry.variants.flatMap((v, i) => (i === variantIndex ? [] : v.prints)).filter((ref) => !current.prints.includes(ref)).map((ref) => ({ ref, group: 'Other printings of this name' })),
    ]
    return refs.map((r, i) => ({ ref: r.ref, thumbUrl: artCropUrl(r.ref) ?? '', label: `Art ${i + 1}`, group: r.group }))
  }, [entry, variantIndex])

  const onEdit = (kind: HotspotKind) => { if (kind === 'art') setArtOpen(true); else setField(kind) }

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Box sx={{ flexGrow: 1 }}>
          <SearchBox loadNames={tokens.loadNames} onPick={tokens.pickToken} disabled={busy || !!tokens.indexError} label="Token name" placeholder="Treasure" />
        </Box>
        <Button onClick={tokens.startBlank} disabled={busy}>Blank token</Button>
      </Stack>
      {tokens.indexError && <Alert severity="error">{tokens.indexError}</Alert>}
      {entry && entry.variants.length > 1 && (
        <Stack direction="row" spacing={1} role="group" aria-label="Variants" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          {entry.variants.map((v, i) => {
            const on = variantKnown && i === variantIndex
            return (
              <Tooltip key={i} title={<span style={{ whiteSpace: 'pre-line' }}>{v.oracleText ? `${v.typeLine}\n${v.oracleText}` : v.typeLine}</span>}>
                <Chip label={variantLabel(v)} clickable aria-pressed={on} color={on ? 'primary' : 'default'} variant="outlined" disabled={busy}
                  onClick={() => tokens.pickVariant(i)} />
              </Tooltip>
            )
          })}
        </Stack>
      )}
      {tokens.artFailed && <Alert severity="info">Art could not be loaded; rendering without it.</Alert>}
      {tokens.fontError && <Alert severity="info">{tokens.fontError}</Alert>}
      {geometry?.overflow && <Alert severity="warning">Rules text was clipped to fit.</Alert>}
      {!draft && <Typography color="text.secondary">Type a token name, or start from a blank token.</Typography>}
      {draft && bits && geometry && (
        <>
          <EditablePreview bits={bits} geometry={geometry} dotsPerLine={settings.dotsPerLine} dpi={settings.dpi}
            enabled={ALL_HOTSPOTS} disabled={busy} onEdit={onEdit}
            print={{ state: printerState, progress: tokens.progress, onPrint: () => { void tokens.print() }, onCancel: tokens.cancel }} />
          {!tokens.touched && <Typography variant="body2" color="text.secondary" align="center">Tap a part of the card to edit it.</Typography>}
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'center' }}>
            <Typography>Copies</Typography>
            <IconButton aria-label="Fewer copies" size="small" disabled={busy || draft.copies <= COPIES_MIN} onClick={() => tokens.edit({ copies: draft.copies - 1 })}><RemoveIcon /></IconButton>
            <TextField size="small" type="number" value={copiesText} disabled={busy}
              slotProps={{ htmlInput: { min: COPIES_MIN, max: COPIES_MAX, 'aria-label': 'Copies', style: { width: 48, textAlign: 'center' } } }}
              onChange={(e) => setCopiesText(e.target.value)} onBlur={commitCopies}
              onKeyDown={(e) => { if (e.key === 'Enter') commitCopies() }} />
            <IconButton aria-label="More copies" size="small" disabled={busy || draft.copies >= COPIES_MAX} onClick={() => tokens.edit({ copies: draft.copies + 1 })}><AddIcon /></IconButton>
          </Stack>
        </>
      )}
      <FieldDialog field={busy ? null : field} card={draft?.card ?? EMPTY_CARD} onSave={(p) => { tokens.edit(p); setField(null) }} onClose={() => setField(null)} />
      <ArtPickerDialog open={artOpen && !busy} options={artOptions} current={draft?.artRef ?? null} noneLabel="No art"
        onPick={(ref) => tokens.edit({ artRef: ref })} onClose={() => setArtOpen(false)} />
    </Stack>
  )
}
