import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('EPUB fixture generator contract', () => {
  it('byte-matches every committed EPUB fixture', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'g2reader-epub-committed-'))
    try {
      const script = new URL('../scripts/generate-epub-fixtures.mjs', import.meta.url)
      const committedDirectory = new URL('../tests/fixtures/', import.meta.url).pathname
      const generated = spawnSync(process.execPath, [script.pathname, '--output-dir', temporaryRoot], {
        cwd: temporaryRoot,
        encoding: 'utf8',
      })
      expect(generated.status, generated.stderr).toBe(0)

      const committed = readdirSync(committedDirectory).filter(name => name.endsWith('.epub')).sort()
      expect(readdirSync(temporaryRoot).sort()).toEqual(committed)
      for (const name of committed) {
        expect(readFileSync(join(temporaryRoot, name)), `${name} drifted from its generator definition`)
          .toEqual(readFileSync(join(committedDirectory, name)))
      }
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })

  it('honors an explicit output directory and focused selection deterministically from any cwd', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'g2reader-epub-fixtures-'))
    try {
      const firstOutput = join(temporaryRoot, 'first')
      const secondOutput = join(temporaryRoot, 'second')
      const unrelatedCwd = join(temporaryRoot, 'unrelated')
      const script = new URL('../scripts/generate-epub-fixtures.mjs', import.meta.url)
      const fixture = 'valid-two-chapters.epub'
      mkdirSync(unrelatedCwd)

      const first = spawnSync(process.execPath, [script.pathname, '--output-dir', firstOutput, fixture], {
        cwd: temporaryRoot,
        encoding: 'utf8',
      })
      const second = spawnSync(process.execPath, [script.pathname, '--output-dir', secondOutput, fixture], {
        cwd: unrelatedCwd,
        encoding: 'utf8',
      })

      expect(first.status, first.stderr).toBe(0)
      expect(second.status, second.stderr).toBe(0)
      expect(existsSync(firstOutput)).toBe(true)
      expect(readdirSync(firstOutput)).toEqual([fixture])
      expect(readdirSync(secondOutput)).toEqual([fixture])
      expect(readFileSync(join(firstOutput, fixture))).toEqual(readFileSync(join(secondOutput, fixture)))
      expect(first.stdout).toContain(firstOutput)
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })
})
