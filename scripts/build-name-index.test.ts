import { describe, it, expect } from 'vitest'
import { readFileSync, rmSync } from 'node:fs'
import { buildNameIndex } from './build-name-index'

describe('buildNameIndex', () => {
  it('keeps only normal-layout, non-token names, sorted and unique', async () => {
    const out = `${process.env.TMPDIR ?? '/tmp'}/names-test.json`
    const n = await buildNameIndex('tests/fixtures/oracle-sample.jsonl', out)
    const names: string[] = JSON.parse(readFileSync(out, 'utf8'))
    rmSync(out)
    expect(n).toBe(names.length)
    expect(names).toContain('Lightning Bolt')
    expect(names.some((x) => x.includes('//'))).toBe(false)
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names)
    expect(new Set(names).size).toBe(names.length)
    const raw = readFileSync('tests/fixtures/oracle-sample.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    for (const c of raw) if (c.layout !== 'normal' || ['token', 'memorabilia', 'minigame'].includes(c.set_type)) expect(names).not.toContain(c.name)
  })
})
