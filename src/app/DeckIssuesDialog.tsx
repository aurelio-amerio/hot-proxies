import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { DeckIssue } from './useDeck'

type NotFound = Extract<DeckIssue, { kind: 'not-found' }>

export interface DeckIssuesDialogProps {
  issues: DeckIssue[] | null
  onApply(issue: NotFound): void
  onApplyAll(): void
  onClose(): void
}

export function issueReason(issue: DeckIssue): string {
  switch (issue.kind) {
    case 'not-found': return 'Not found'
    case 'unsupported-layout': return `Layout '${issue.layout}' is not supported`
    case 'bad-count': return 'Count must be 1 to 99'
  }
}

/** Lists the lines Verify could not resolve. Closing leaves the list unverified; the user must press Verify again. */
export function DeckIssuesDialog({ issues, onApply, onApplyAll, onClose }: DeckIssuesDialogProps) {
  const open = !!issues && issues.length > 0
  const list = issues ?? []
  const fixable = list.some((i) => i.kind === 'not-found' && i.suggestion)
  const title = `${list.length} ${list.length === 1 ? 'card' : 'cards'} could not be resolved`
  return (
    <Dialog open={open} onClose={onClose} aria-labelledby="deck-issues-title" fullWidth maxWidth="sm">
      <DialogTitle id="deck-issues-title">{title}</DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        <List dense disablePadding>
          {list.map((issue) => (
            <ListItem key={issue.line} divider sx={{ alignItems: 'flex-start', gap: 1.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ minWidth: 48, pt: 0.5 }}>{`Line ${issue.line}`}</Typography>
              <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography sx={{ fontFamily: 'monospace', fontSize: 14, overflowWrap: 'anywhere' }}>{issue.text}</Typography>
                <Typography variant="body2" color="text.secondary">{issueReason(issue)}</Typography>
              </Stack>
              {issue.kind === 'not-found' && issue.suggestion && (
                <Button size="small" variant="outlined" onClick={() => onApply(issue)} sx={{ flexShrink: 0, alignSelf: 'center' }}>{issue.suggestion}</Button>
              )}
            </ListItem>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        {fixable && <Button onClick={onApplyAll}>Fix all</Button>}
        <Button onClick={onClose} variant="contained">Close</Button>
      </DialogActions>
    </Dialog>
  )
}
