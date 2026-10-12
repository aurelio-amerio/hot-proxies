export interface CardData {
  name: string
  manaCost: string            // Scryfall notation, "" for lands
  typeLine: string
  oracleText: string          // paragraphs separated by "\n"
  stat?: { kind: 'pt'; power: string; toughness: string } | { kind: 'loyalty'; value: string }
  artUrl?: string
}
