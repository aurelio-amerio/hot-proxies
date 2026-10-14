// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PrinterChip, chipLabel } from './PrinterChip'

describe('chipLabel', () => {
  it('matches the spec table', () => {
    expect(chipLabel('unsupported', null)).toBe('No Bluetooth')
    expect(chipLabel('disconnected', null)).toBe('Connect printer')
    expect(chipLabel('disconnected', 'PT210')).toBe('PT210: tap to reconnect')
    expect(chipLabel('connecting', null)).toBe('Connecting…')
    expect(chipLabel('connected', 'PT210')).toBe('PT210')
    expect(chipLabel('printing', 'PT210')).toBe('PT210: printing')
  })
})

describe('PrinterChip', () => {
  it('connects on tap when disconnected', async () => {
    const onConnect = vi.fn()
    render(<PrinterChip state="disconnected" name={null} onConnect={onConnect} onDisconnect={() => {}} />)
    await userEvent.click(screen.getByText('Connect printer'))
    expect(onConnect).toHaveBeenCalledTimes(1)
  })
  it('offers Disconnect in a menu when connected', async () => {
    const onDisconnect = vi.fn()
    render(<PrinterChip state="connected" name="PT210" onConnect={() => {}} onDisconnect={onDisconnect} />)
    await userEvent.click(screen.getByText('PT210'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Disconnect' }))
    expect(onDisconnect).toHaveBeenCalledTimes(1)
  })
  it('does nothing on tap while connecting or printing', async () => {
    const onConnect = vi.fn(), onDisconnect = vi.fn()
    const { rerender } = render(<PrinterChip state="connecting" name={null} onConnect={onConnect} onDisconnect={onDisconnect} />)
    await userEvent.click(screen.getByText('Connecting…'))
    rerender(<PrinterChip state="printing" name="PT210" onConnect={onConnect} onDisconnect={onDisconnect} />)
    await userEvent.click(screen.getByText('PT210: printing'))
    expect(onConnect).not.toHaveBeenCalled(); expect(onDisconnect).not.toHaveBeenCalled()
  })
  it('is disabled with the hint when unsupported', () => {
    render(<PrinterChip state="unsupported" name={null} onConnect={() => {}} onDisconnect={() => {}} />)
    const chip = screen.getByText('No Bluetooth').closest('[aria-disabled], .Mui-disabled')
    expect(chip).not.toBeNull()
  })
})
