// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ArtPickerDialog, type ArtOption } from './ArtPickerDialog'

const options: ArtOption[] = [
  { ref: 'a1', thumbUrl: 'https://c/a1.jpg', label: 'Art 1', group: 'This variant' },
  { ref: 'a2', thumbUrl: 'https://c/a2.jpg', label: 'Art 2', group: 'This variant' },
  { ref: 'b1', thumbUrl: 'https://c/b1.jpg', label: 'Art 3', group: 'Other printings of this name' },
]

describe('ArtPickerDialog', () => {
  it('lists a none tile and every option with group headings, marks the current one, and picks', async () => {
    const onPick = vi.fn(), onClose = vi.fn()
    render(<ArtPickerDialog open options={options} current="a2" noneLabel="No art" onPick={onPick} onClose={onClose} />)
    expect(screen.getByRole('button', { name: 'No art' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Art 2' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('img', { name: 'Art 3' })).toHaveAttribute('src', 'https://c/b1.jpg')
    expect(screen.getByText('This variant')).toBeInTheDocument()
    expect(screen.getByText('Other printings of this name')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Art 3' }))
    expect(onPick).toHaveBeenCalledWith('b1'); expect(onClose).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'No art' }))
    expect(onPick).toHaveBeenLastCalledWith(null)
  })
  it('shows a progress bar while options are null and the error text when given', () => {
    const { rerender } = render(<ArtPickerDialog open options={null} current={null} noneLabel="Default art" onPick={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('progressbar', { name: 'Loading printings' })).toBeInTheDocument()
    rerender(<ArtPickerDialog open options={null} error="Could not load other printings." current={null} noneLabel="Default art" onPick={() => {}} onClose={() => {}} />)
    expect(screen.getByText('Could not load other printings.')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.getByRole('button', { name: 'Default art' })).toBeInTheDocument()
  })
  it('says so when there are no other printings', () => {
    render(<ArtPickerDialog open options={[]} current={null} noneLabel="Default art" onPick={() => {}} onClose={() => {}} />)
    expect(screen.getByText('No printings with art found.')).toBeInTheDocument()
  })
})
