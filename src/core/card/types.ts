export type Stat =
  | { kind: 'pt'; power: string; toughness: string }
  | { kind: 'loyalty'; value: string }
  | { kind: 'defense'; value: string }

export interface Face {
  name: string
  manaCost: string            // Scryfall notation, "" for lands
  typeLine: string
  oracleText: string          // paragraphs separated by "\n"
  stat?: Stat
  artUrl?: string
}

export type CardData = Face   // alias; Tokens mode keeps compiling

export interface Section {
  header?: { label: string; cost?: string; stat?: Stat }
  badges?: string[]
  text: string
}

export type Sheet =
  | { kind: 'standard'; face: Face }
  | { kind: 'columns'; face: Face; sections: Section[] }
  | { kind: 'stacked'; face: Face; sub: Face }
  | { kind: 'split'; halves: [Face, Face] }

export interface ProxyCard {
  name: string
  sheets: [Sheet] | [Sheet, Sheet]
  meldResult?: string
  meldBack?: true
}

export function standardSheet(face: Face): Sheet {
  return { kind: 'standard', face }
}

/** The face(s) a sheet draws. */
export function sheetFaces(sheet: Sheet): Face[] {
  switch (sheet.kind) {
    case 'standard':
    case 'columns':
      return [sheet.face]
    case 'stacked':
      return [sheet.face, sheet.sub]
    case 'split':
      return [...sheet.halves]
  }
}

export function statLabel(stat: Stat): string {
  return stat.kind === 'pt' ? `${stat.power}/${stat.toughness}` : stat.value
}
