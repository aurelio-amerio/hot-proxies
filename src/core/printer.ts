/** PT-210 class printer: 58 mm roll, 48 mm printable, 203 dpi. */
export const DOTS_PER_LINE = 384
export const DPI = 203
/** Card height in dots for a given width, keeping the real 63:88 card ratio. */
export function cardHeight(width: number): number {
  return Math.round((width * 88) / 63)
}
