// Runs before a test file loads anything, so no import can reach the real archive in ./data.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'family-test-'))
