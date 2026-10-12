// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsDrawer } from './SettingsDrawer'
import { useSettings } from './useSettings'
import type { Settings } from '../core/settings'

let latest: Settings | undefined
function Harness() {
  const [settings, update, reset] = useSettings({ getItem: () => null, setItem: () => {} })
  latest = settings
  return <SettingsDrawer open onClose={() => {}} settings={settings} update={update} reset={reset} />
}

describe('SettingsDrawer printer fields', () => {
  it('lets the user type a full dots-per-line value and commits it on blur', async () => {
    render(<Harness />)
    const field = screen.getByLabelText('Dots per line')
    await userEvent.clear(field)
    await userEvent.type(field, '576')
    await userEvent.tab()
    expect(latest!.dotsPerLine).toBe(576)
    expect(field).toHaveValue(576)
  })
  it('commits DPI on Enter and clamps out-of-range input only then', async () => {
    render(<Harness />)
    const field = screen.getByLabelText('DPI')
    await userEvent.clear(field)
    await userEvent.type(field, '300{enter}')
    expect(latest!.dpi).toBe(300)
    await userEvent.clear(field)
    await userEvent.type(field, '9999')
    await userEvent.tab()
    expect(latest!.dpi).toBe(400)
    expect(field).toHaveValue(400)
  })
})
