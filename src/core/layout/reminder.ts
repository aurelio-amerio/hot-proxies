/** Remove Scryfall reminder text "( … )". Paragraphs left empty are dropped. */
export function stripReminder(text: string): string {
  return text
    .split('\n')
    .map((p) => p.replace(/\s*\([^)]*\)/g, '').replace(/\s{2,}/g, ' ').trim())
    .filter((p) => p.length > 0)
    .join('\n')
}
