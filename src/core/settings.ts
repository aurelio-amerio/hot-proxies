import { DOTS_PER_LINE, DPI } from './printer'

export type DitherName = 'atkinson' | 'floyd-steinberg' | 'bayer4' | 'threshold'
export const DITHER_NAMES: DitherName[] = ['atkinson', 'floyd-steinberg', 'bayer4', 'threshold']
export type FontFamilyName = 'ProxySerif' | 'MPlantin'

export interface Settings {
  dither: DitherName
  block: 1 | 2
  gamma: number          // 0.8 .. 1.6
  contrastCutoff: number // 0 .. 5 (percent)
  textSize: number       // 14 .. 28
  nameSize: number       // 16 .. 30
  stripReminder: boolean
  dotsPerLine: number    // 192 .. 832
  dpi: number            // 100 .. 400
  fontFamily: FontFamilyName
}

export const DEFAULT_SETTINGS: Settings = {
  dither: 'atkinson', block: 1, gamma: 1.2, contrastCutoff: 1,
  textSize: 24, nameSize: 26, stripReminder: true,
  dotsPerLine: DOTS_PER_LINE, dpi: DPI, fontFamily: 'ProxySerif',
}

export const RANGES = {
  gamma: [0.8, 1.6], contrastCutoff: [0, 5], textSize: [14, 28], nameSize: [16, 30],
  dotsPerLine: [192, 832], dpi: [100, 400],
} as const

function num(v: unknown, [lo, hi]: readonly [number, number], dflt: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return dflt
  return Math.min(hi, Math.max(lo, v))
}

/** Coerce anything (e.g. parsed localStorage) into a valid Settings, field by field. */
export function normalizeSettings(input: unknown): Settings {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS
  return {
    dither: DITHER_NAMES.includes(o.dither as DitherName) ? (o.dither as DitherName) : d.dither,
    block: o.block === 2 ? 2 : 1,
    gamma: num(o.gamma, RANGES.gamma, d.gamma),
    contrastCutoff: num(o.contrastCutoff, RANGES.contrastCutoff, d.contrastCutoff),
    textSize: Math.round(num(o.textSize, RANGES.textSize, d.textSize)),
    nameSize: Math.round(num(o.nameSize, RANGES.nameSize, d.nameSize)),
    stripReminder: typeof o.stripReminder === 'boolean' ? o.stripReminder : d.stripReminder,
    dotsPerLine: Math.round(num(o.dotsPerLine, RANGES.dotsPerLine, d.dotsPerLine)),
    dpi: Math.round(num(o.dpi, RANGES.dpi, d.dpi)),
    fontFamily: o.fontFamily === 'MPlantin' ? 'MPlantin' : 'ProxySerif',
  }
}
