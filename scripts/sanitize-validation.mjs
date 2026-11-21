import fs from 'node:fs'
import path from 'node:path'
import { ROOT, VALIDATION } from './lib.mjs'

const report = path.join(VALIDATION, 'browser-results.json')
if (fs.existsSync(report)) {
  const portable = fs.readFileSync(report, 'utf8').replaceAll(ROOT, '<submission>')
  fs.writeFileSync(report, portable)
}
// Successful runs need no retry traces. Failure traces are retained for debugging
// because this script is only executed after Playwright exits successfully.
fs.rmSync(path.join(VALIDATION, 'test-results'), { recursive: true, force: true })
fs.rmSync(path.join(VALIDATION, 'playwright-report'), { recursive: true, force: true })
