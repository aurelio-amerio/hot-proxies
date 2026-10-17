import {
  ART_MAX, ART_MID, ART_MIN, ART_STEP, TEXT_MIN, TEXT_FLOOR,
  COL_ART_MAX, COL_ART_MID, COL_ART_MIN, COL_ART_STEP, SPLIT_ART_MAX, SPLIT_ART_MIN, SPLIT_ART_STEP,
} from './constants'

export interface FitCandidate { textSize: number; artH: number; stripped: boolean }

/** The ordered list of (text size, art height, reminder stripped) combinations to try. Spec 5.5. */
export function fitCandidates(baseTextSize: number, stripSetting: boolean): FitCandidate[] {
  const out: FitCandidate[] = []
  const textPhase = (stripped: boolean) => {
    for (let t = baseTextSize; t >= TEXT_MIN; t--) out.push({ textSize: t, artH: ART_MID, stripped })
    for (let a = ART_MID - ART_STEP; a >= ART_MIN; a -= ART_STEP) out.push({ textSize: TEXT_MIN, artH: a, stripped })
  }
  for (let a = ART_MAX; a >= ART_MID; a -= ART_STEP) out.push({ textSize: baseTextSize, artH: a, stripped: stripSetting })
  // the first text-phase entry (base, 180) duplicates the last art entry; skip it
  const before = out.length
  textPhase(stripSetting); out.splice(before, 1)
  if (!stripSetting) textPhase(true)
  for (let t = TEXT_MIN - 1; t >= TEXT_FLOOR; t--) out.push({ textSize: t, artH: ART_MIN, stripped: true })
  return out
}

export interface ColumnCandidate { textSize: number; colW: number; stripped: boolean }   // colW 0 = column dropped

/** Text sizes from `from` down to `to`, inclusive; empty when from < to. */
function sizes(from: number, to: number): number[] {
  const out: number[] = []
  for (let t = from; t >= to; t--) out.push(t)
  return out
}

/** Sizes to try with the art gone: base down to the readable text size, then the last-resort sizes below it. */
function artlessSizes(base: number): number[] {
  return [...sizes(base, TEXT_MIN), ...sizes(Math.min(TEXT_MIN - 1, base), TEXT_FLOOR)]
}

/** Drops entries equal to their predecessor (base at or below TEXT_MIN makes ranges overlap). */
function dedupe<T extends object>(list: T[]): T[] {
  return list.filter((x, i) => i === 0 || JSON.stringify(x) !== JSON.stringify(list[i - 1]))
}

/** Columns sheets: shrink the art column, then text to 14, then the column to its minimum, then strip, then drop the column. */
export function columnCandidates(base: number, strip: boolean): ColumnCandidate[] {
  const lo = Math.min(base, TEXT_MIN)
  const out: ColumnCandidate[] = []
  const phase = (stripped: boolean) => {
    for (let w = COL_ART_MAX; w >= COL_ART_MID; w -= COL_ART_STEP) out.push({ textSize: base, colW: w, stripped })
    for (const t of sizes(base - 1, lo)) out.push({ textSize: t, colW: COL_ART_MID, stripped })
    for (let w = COL_ART_MID - COL_ART_STEP; w >= COL_ART_MIN; w -= COL_ART_STEP) out.push({ textSize: lo, colW: w, stripped })
  }
  phase(strip)
  if (!strip) {
    for (const t of sizes(base, lo)) out.push({ textSize: t, colW: COL_ART_MID, stripped: true })
    for (let w = COL_ART_MID - COL_ART_STEP; w >= COL_ART_MIN; w -= COL_ART_STEP) out.push({ textSize: lo, colW: w, stripped: true })
  }
  for (const t of artlessSizes(base)) out.push({ textSize: t, colW: 0, stripped: true })
  return dedupe(out)
}

/** Stacked sheets: the standard order, but the last resort drops the art instead of keeping it at its minimum. */
export function stackedCandidates(base: number, strip: boolean): FitCandidate[] {
  const out = fitCandidates(base, strip).filter((c) => c.textSize >= TEXT_MIN)
  for (const t of artlessSizes(base)) out.push({ textSize: t, artH: 0, stripped: true })
  return dedupe(out)
}

/** Split sheets: shrink the art per half, then text to 14, then strip, then drop the art. */
export function splitCandidates(base: number, strip: boolean): FitCandidate[] {
  const lo = Math.min(base, TEXT_MIN)
  const out: FitCandidate[] = []
  for (let a = SPLIT_ART_MAX; a >= SPLIT_ART_MIN; a -= SPLIT_ART_STEP) out.push({ textSize: base, artH: a, stripped: strip })
  for (const t of sizes(base - 1, lo)) out.push({ textSize: t, artH: SPLIT_ART_MIN, stripped: strip })
  if (!strip) for (const t of sizes(base, lo)) out.push({ textSize: t, artH: SPLIT_ART_MIN, stripped: true })
  for (const t of artlessSizes(base)) out.push({ textSize: t, artH: 0, stripped: true })
  return dedupe(out)
}
