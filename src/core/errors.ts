export class CardNotFound extends Error {
  constructor(public readonly cardName: string) { super(`Scryfall has no card named "${cardName}".`); this.name = 'CardNotFound' }
}
export class NetworkError extends Error {
  constructor(message = 'Could not reach Scryfall. Check your connection.') { super(message); this.name = 'NetworkError' }
}
export class UnsupportedLayout extends Error {
  constructor(public readonly cardName: string, public readonly layout: string) {
    super(`${cardName} uses the '${layout}' layout, which is not supported yet.`); this.name = 'UnsupportedLayout'
  }
}
export class ArtUnavailable extends Error {
  constructor() { super('Art could not be loaded; rendering without it.'); this.name = 'ArtUnavailable' }
}
