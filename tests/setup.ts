// Runs before a test file loads anything, so no import can reach the real archive in ./data.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach } from 'vitest'

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'family-test-'))

// These tests read the app's Russian words. An archive with no choice yet is English: tests/language.test.ts checks that.
beforeEach(async () => {
  const { setSetting } = await import('../lib/ops/app-config')
  setSetting('language', 'ru')
})
