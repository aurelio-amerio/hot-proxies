// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeckIssuesDialog, issueReason } from './DeckIssuesDialog'
import type { DeckIssue } from './useDeck'

const issues: DeckIssue[] = [
  { kind: 'not-found', line: 1, text: '4 Lightnin Bolt (STA) 42', name: 'Lightnin Bolt', suggestion: 'Lightning Bolt' },
  { kind: 'bad-count', line: 2, text: '0 Forest' },
  { kind: 'unsupported-layout', line: 3, text: '1 Delver of Secrets', name: 'Delver of Secrets', layout: 'transform' },
  { kind: 'not-found', line: 4, text: '1 Zzzzqqq', name: 'Zzzzqqq', suggestion: null },
]

describe('issueReason', () => {
  it('words each kind', () => {
    expect(issueReason(issues[0])).toBe('Not found')
    expect(issueReason(issues[1])).toBe('Count must be 1 to 99')
    expect(issueReason(issues[2])).toBe("Layout 'transform' is not supported")
  })
})

describe('DeckIssuesDialog', () => {
  it('renders nothing when there are no issues', () => {
    render(<DeckIssuesDialog issues={null} onApply={() => {}} onApplyAll={() => {}} onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('lists each issue with line, text and reason, and a suggestion button where available', () => {
    render(<DeckIssuesDialog issues={issues} onApply={() => {}} onApplyAll={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: '4 cards could not be resolved' })).toBeInTheDocument()
    expect(screen.getByText('Line 1')).toBeInTheDocument()
    expect(screen.getByText('4 Lightnin Bolt (STA) 42')).toBeInTheDocument()
    expect(screen.getAllByText('Not found').length).toBe(2)
    expect(screen.getByText("Layout 'transform' is not supported")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lightning Bolt' })).toBeInTheDocument()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Lightning Bolt', 'Fix all', 'Close'])
  })
  it('uses the singular title for one issue and hides Fix all when nothing can be fixed', () => {
    render(<DeckIssuesDialog issues={[issues[3]]} onApply={() => {}} onApplyAll={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: '1 card could not be resolved' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fix all' })).toBeNull()
  })
  it('wires the buttons', async () => {
    const onApply = vi.fn(), onApplyAll = vi.fn(), onClose = vi.fn()
    render(<DeckIssuesDialog issues={issues} onApply={onApply} onApplyAll={onApplyAll} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Lightning Bolt' }))
    expect(onApply).toHaveBeenCalledWith(issues[0])
    await userEvent.click(screen.getByRole('button', { name: 'Fix all' }))
    expect(onApplyAll).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })
})
