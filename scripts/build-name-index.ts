/** JSONL oracle dump -> public/names.json (sorted unique names of normal-layout playable cards).
 *  Run: npm run build:names -- oracle-cards-YYYYMMDDhhmmss.jsonl */
import { createReadStream, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const EXCLUDED_SET_TYPES = new Set(['token', 'memorabilia', 'minigame'])

export async function buildNameIndex(inputPath: string, outputPath: string): Promise<number> {
  const names = new Set<string>()
  const rl = createInterface({ input: createReadStream(inputPath), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.trim()) continue
    const c = JSON.parse(line) as { name?: string; layout?: string; set_type?: string }
    if (c.layout !== 'normal' || !c.name || EXCLUDED_SET_TYPES.has(c.set_type ?? '')) continue
    names.add(c.name)
  }
  const sorted = [...names].sort((a, b) => a.localeCompare(b))
  writeFileSync(outputPath, JSON.stringify(sorted))
  return sorted.length
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))
if (isMain) {
  const input = process.argv[2]
  if (!input) { console.error('usage: tsx scripts/build-name-index.ts <oracle-cards.jsonl>'); process.exit(1) }
  buildNameIndex(input, 'public/names.json').then((n) => console.log(`wrote ${n} names to public/names.json`))
}
