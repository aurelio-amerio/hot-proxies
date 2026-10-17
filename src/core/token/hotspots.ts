import type { Geometry, Rect } from '../layout/fit'

export type HotspotKind = 'name' | 'art' | 'type' | 'rules' | 'stat'
export interface Hotspot { kind: HotspotKind; rect: Rect; label: string }

export const HOTSPOT_LABELS: Record<HotspotKind, string> = {
  name: 'Edit name', art: 'Change art', type: 'Edit type line', rules: 'Edit rules text', stat: 'Edit power and toughness',
}
/** Where the stat hotspot sits when the card has no stat box yet, so a P/T can be added. In dots. */
export const STAT_HOTSPOT = { w: 96, h: 32 }

/** Clickable regions of a rendered card, in card dots. Stat comes last so the view can stack it above rules. */
export function hotspotsFor(g: Geometry): Hotspot[] {
  const stat: Rect = g.statBox ?? {
    x: g.textBox.x + g.textBox.w - STAT_HOTSPOT.w, y: g.textBox.y + g.textBox.h - STAT_HOTSPOT.h, w: STAT_HOTSPOT.w, h: STAT_HOTSPOT.h,
  }
  return [
    { kind: 'name', rect: g.nameBar, label: HOTSPOT_LABELS.name },
    { kind: 'art', rect: g.art, label: HOTSPOT_LABELS.art },
    { kind: 'type', rect: g.typeBar, label: HOTSPOT_LABELS.type },
    { kind: 'rules', rect: g.textBox, label: HOTSPOT_LABELS.rules },
    { kind: 'stat', rect: stat, label: HOTSPOT_LABELS.stat },
  ]
}
