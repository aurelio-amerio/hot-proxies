import { ART_MAX, ART_MID, ART_MIN, ART_STEP, TEXT_MIN, TEXT_FLOOR } from './constants'

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
