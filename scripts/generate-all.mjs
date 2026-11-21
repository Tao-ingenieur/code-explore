import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { ROOT, SUBMISSION, readJson } from './lib.mjs'

fs.mkdirSync(SUBMISSION, { recursive: true })

for (const entry of fs.readdirSync(SUBMISSION, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const descriptorPath = path.join(SUBMISSION, entry.name, 'project.json')
  if (!fs.existsSync(descriptorPath)) continue
  const descriptor = readJson(descriptorPath)
  if (descriptor.type === 'comparison') continue
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/import-project.mjs'), '--project', descriptor.id], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status || 1)
}
