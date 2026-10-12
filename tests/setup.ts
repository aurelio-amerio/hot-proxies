import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Testing Library only auto-cleans when vitest globals are on; we keep globals off.
afterEach(() => cleanup())
