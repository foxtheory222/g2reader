import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('PDF fixture generator contract', () => {
  it('honors an explicit output directory and focused fixture selection from any cwd', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'g2reader-fixtures-'))
    try {
      const copiedScript = join(temporaryRoot, 'copy', 'scripts', 'generate-pdf-fixtures.swift')
      const outputDirectory = join(temporaryRoot, 'selected-output')
      const unrelatedCwd = join(temporaryRoot, 'unrelated-cwd')
      const sourceScript = new URL('../scripts/generate-pdf-fixtures.swift', import.meta.url)
      requireDirectory(dirname(copiedScript))
      requireDirectory(unrelatedCwd)
      copyFileSync(sourceScript, copiedScript)

      const result = spawnSync('swift', [
        copiedScript,
        '--output-dir',
        outputDirectory,
        'no-text.pdf',
      ], {
        cwd: unrelatedCwd,
        encoding: 'utf8',
        env: {
          ...process.env,
          CLANG_MODULE_CACHE_PATH: join(temporaryRoot, 'clang-cache'),
          SWIFT_MODULECACHE_PATH: join(temporaryRoot, 'swift-cache'),
        },
      })

      expect(result.status, result.stderr).toBe(0)
      expect(existsSync(outputDirectory)).toBe(true)
      expect(readdirSync(outputDirectory)).toEqual(['no-text.pdf'])
      expect(result.stdout).toContain(outputDirectory)
      expect(result.stdout).toContain('regeneration is not byte-identical')
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })
})

function requireDirectory(path: string) {
  mkdirSync(path, { recursive: true })
}
