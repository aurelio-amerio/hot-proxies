import { describe, it, expect } from 'vitest'
import { readFileSync, rmSync } from 'node:fs'
import { buildNameIndex } from './build-name-index'

describe('buildNameIndex', () => {
  it('keeps every supported layout, sorted and unique, and drops excluded layouts and tokens', async () => {
    const out = `${process.env.TMPDIR ?? '/tmp'}/names-test.json`
    const n = await buildNameIndex('tests/fixtures/oracle-sample.jsonl', out)
    const names: string[] = JSON.parse(readFileSync(out, 'utf8'))
    rmSync(out)
    expect(n).toBe(names.length)
    expect(names).toContain('Lightning Bolt')
    expect(names).toContain('Fire // Ice')
    expect(names).toContain('History of Benalia')
    expect(names).toContain('Delver of Secrets // Insectile Aberration')
    expect(names).not.toContain('Academy at Tolaria West')
    expect(names).not.toContain('Treasure')
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names)
    expect(new Set(names).size).toBe(names.length)
    const raw = readFileSync('tests/fixtures/oracle-sample.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    const dropped = ['planar', 'scheme', 'vanguard', 'art_series', 'augment', 'host', 'token', 'double_faced_token', 'emblem']
    for (const c of raw) if (dropped.includes(c.layout) || ['token', 'memorabilia', 'minigame'].includes(c.set_type)) expect(names).not.toContain(c.name)
  })
})
