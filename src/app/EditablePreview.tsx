import Box from '@mui/material/Box'
import { alpha } from '@mui/material/styles'
import type { Geometry } from '../core/layout/fit'
import { hotspotsFor, type HotspotKind } from '../core/token/hotspots'
import { Preview, type PreviewProps } from './Preview'
import { INK } from './theme'

export interface EditablePreviewProps extends Omit<PreviewProps, 'overlay'> {
  geometry: Geometry
  /** Which regions are clickable: all five in Tokens, only 'art' in Card mode. */
  enabled: HotspotKind[]
  disabled?: boolean
  onEdit(kind: HotspotKind): void
}

/** The bitmap preview with transparent buttons over the card's regions, sized in percent so any zoom works. */
export function EditablePreview({ geometry, enabled, disabled, onEdit, ...preview }: EditablePreviewProps) {
  const { w, h } = geometry.card
  const spots = hotspotsFor(geometry).filter((s) => enabled.includes(s.kind))
  const overlay = (
    <Box data-testid="hotspots" sx={{ position: 'absolute', inset: 0 }}>
      {spots.map((s) => (
        <Box key={s.kind} component="button" type="button" aria-label={s.label} disabled={disabled} onClick={() => onEdit(s.kind)}
          style={{ left: `${(100 * s.rect.x) / w}%`, top: `${(100 * s.rect.y) / h}%`, width: `${(100 * s.rect.w) / w}%`, height: `${(100 * s.rect.h) / h}%` }}
          sx={{
            position: 'absolute', p: 0, m: 0, background: 'transparent', border: '1px dashed transparent', borderRadius: 1,
            cursor: disabled ? 'default' : 'pointer',
            '&:not(:disabled):hover, &:focus-visible': { borderColor: 'primary.main', outline: 'none', background: alpha(INK, 0.04) },
          }} />
      ))}
    </Box>
  )
  return <Preview {...preview} overlay={overlay} />
}
